// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { eq } from "drizzle-orm";
import { getSegment, type ReportKind, type SegmentId } from "@nissegroup/shared";
import type { DbContext } from "../db/client.js";
import { reports, type IncidentType, type ReportRow, type TrustLevel } from "../db/schema.js";
import type { RedisClient } from "../redis/client.js";
import { isKnownToken, rateLimit, rememberToken } from "../redis/client.js";
import type { Config } from "../config.js";
import { matchOrCreateIncident, reconcile } from "./reconciler.js";
import type { LlmExtractor } from "./llm.js";
import { stubLlmExtractor } from "./llm.js";

/** Default deriveStatus kind for each canned type when there is no note to classify. */
const DEFAULT_KIND: Record<IncidentType, ReportKind> = {
  crash: "single-lane",
  hazard: "single-lane",
  debris: "single-lane",
  "stopped-traffic": "delay",
  weather: "delay",
  wildlife: "delay",
};

const INCIDENT_TYPE_LABEL: Record<IncidentType, string> = {
  crash: "Crash",
  hazard: "Hazard",
  debris: "Debris on road",
  "stopped-traffic": "Stopped traffic",
  weather: "Weather",
  wildlife: "Wildlife",
};

/**
 * Public reports (source='web') may never, on their own, produce a full closure
 * or a "clear" — those require a steward or an official event. Anon/known kinds
 * are clamped to the partial family.
 */
function clampKindForTrust(kind: ReportKind, trust: TrustLevel): ReportKind {
  if (trust === "steward") return kind;
  if (kind === "closure") return "single-lane";
  if (kind === "clear") return "delay";
  return kind;
}

export interface SubmitReportInput {
  incidentType: IncidentType;
  segmentId?: SegmentId;
  lat?: number;
  lon?: number;
  note?: string;
  contact?: string;
  deviceToken?: string;
}

export interface SubmitReportDeps {
  ctx: DbContext;
  redis?: RedisClient;
  config: Config;
  llm?: LlmExtractor;
  ip: string;
}

export type SubmitReportResult =
  | { ok: true; report: { id: string; segmentId: SegmentId; kind: ReportKind; trustLevel: TrustLevel; moderationState: string } }
  | { ok: false; error: "rate_limited" | "bad_location"; message: string };

/** Classify a device token's trust level. */
async function classifyTrust(
  redis: RedisClient | undefined,
  config: Config,
  token: string | undefined,
): Promise<TrustLevel> {
  if (token && config.STEWARD_TOKENS.includes(token)) return "steward";
  if (redis && token && (await isKnownToken(redis, token))) return "known";
  return "anon";
}

async function nearestSegment(ctx: DbContext, lon: number, lat: number): Promise<SegmentId | null> {
  const rows = await ctx.sql<{ id: SegmentId }[]>`
    SELECT id FROM segments
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

/**
 * Ingest a public report: rate-limit, classify trust, resolve the segment,
 * run the LLM enrichment hook, store as source='web', then feed it through the
 * reconciler exactly like any other report. A single anon report can never flip
 * the banner (enforced in deriveStatus).
 */
export async function submitReport(
  input: SubmitReportInput,
  deps: SubmitReportDeps,
): Promise<SubmitReportResult> {
  const { ctx, redis, config } = deps;
  const now = new Date();
  const llm = deps.llm ?? stubLlmExtractor;

  const trust = await classifyTrust(redis, config, input.deviceToken);

  // Rate limit anon/known submissions by IP and device token.
  if (trust !== "steward" && redis) {
    const ipCheck = await rateLimit(redis, `ip:${deps.ip}`, config.REPORT_RATE_MAX_IP, config.REPORT_RATE_WINDOW_SEC);
    if (!ipCheck.allowed) {
      return { ok: false, error: "rate_limited", message: "Too many reports from your network. Try again shortly." };
    }
    if (input.deviceToken) {
      const tokCheck = await rateLimit(redis, `tok:${input.deviceToken}`, config.REPORT_RATE_MAX_TOKEN, config.REPORT_RATE_WINDOW_SEC);
      if (!tokCheck.allowed) {
        return { ok: false, error: "rate_limited", message: "You've reported a lot recently. Try again shortly." };
      }
    }
  }

  // Resolve the segment: explicit id, else nearest to the map pin.
  let segmentId: SegmentId | null = input.segmentId ?? null;
  const hasGeo = typeof input.lat === "number" && typeof input.lon === "number";
  if (!segmentId && hasGeo) {
    segmentId = await nearestSegment(ctx, input.lon!, input.lat!);
  }
  if (!segmentId) {
    return { ok: false, error: "bad_location", message: "A segment or map location is required." };
  }

  // LLM enrichment: classify the note into a kind + summary. Deterministic
  // deriveStatus never sees the LLM — this only sets stored fields.
  const segmentName = getSegment(segmentId)?.name;
  let kind: ReportKind = DEFAULT_KIND[input.incidentType];
  let summary = INCIDENT_TYPE_LABEL[input.incidentType];
  let severity: string | null = null;
  if (input.note && input.note.trim()) {
    const extraction = await llm.extract(input.note.trim(), { incidentType: input.incidentType, segmentName });
    kind = extraction.kind;
    summary = extraction.summary;
    severity = extraction.severity;
  }
  kind = clampKindForTrust(kind, trust);

  const isSteward = trust === "steward";
  const confidence = isSteward ? "confirmed" : "unconfirmed";
  const reporterId = input.deviceToken ? `web:${input.deviceToken.slice(0, 12)}` : "web-anon";

  // Insert (two variants — with or without a map-pin geometry).
  const insert = hasGeo
    ? ctx.sql<{ id: string }[]>`
        INSERT INTO reports
          (segment_id, source, kind, reporter_id, is_steward, incident_type, trust_level, contact,
           device_token, raw_text, summary, severity, confidence, moderation_state, geom, active, created_at, updated_at)
        VALUES
          (${segmentId}, 'web', ${kind}, ${reporterId}, ${isSteward}, ${input.incidentType}, ${trust},
           ${input.contact ?? null}, ${input.deviceToken ?? null}, ${input.note ?? null}, ${summary}, ${severity},
           ${confidence}, 'pending',
           ST_SetSRID(ST_MakePoint(${input.lon!}, ${input.lat!}), 4326), true,
           ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
        RETURNING id`
    : ctx.sql<{ id: string }[]>`
        INSERT INTO reports
          (segment_id, source, kind, reporter_id, is_steward, incident_type, trust_level, contact,
           device_token, raw_text, summary, severity, confidence, moderation_state, active, created_at, updated_at)
        VALUES
          (${segmentId}, 'web', ${kind}, ${reporterId}, ${isSteward}, ${input.incidentType}, ${trust},
           ${input.contact ?? null}, ${input.deviceToken ?? null}, ${input.note ?? null}, ${summary}, ${severity},
           ${confidence}, 'pending', true,
           ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
        RETURNING id`;

  const created = await insert;
  const reportId = created[0]!.id;

  if (redis && input.deviceToken) await rememberToken(redis, input.deviceToken);

  const row = await ctx.db.select().from(reports).where(eq(reports.id, reportId));
  if (row[0]) await matchOrCreateIncident(ctx, row[0] as ReportRow, now);

  await reconcile(ctx, { cause: "web-report", actor: "web", now });

  return {
    ok: true,
    report: { id: reportId, segmentId, kind, trustLevel: trust, moderationState: "pending" },
  };
}
