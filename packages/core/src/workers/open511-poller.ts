// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { SegmentId } from "@nissegroup/shared";
import { eq } from "drizzle-orm";
import type { DbContext } from "../db/client.js";
import { reports, type ReportRow } from "../db/schema.js";
import type { RedisClient } from "../redis/client.js";
import { REDIS_KEYS } from "../redis/client.js";
import { fetchOpen511Events, type FetchFn } from "../open511/client.js";
import { normalizeEvent } from "../open511/normalize.js";
import type { LlmExtractor } from "../services/llm.js";
import { stubLlmExtractor } from "../services/llm.js";
import { matchOrCreateIncident, reconcile } from "../services/reconciler.js";
import { bustStatusCache } from "../services/cache.js";
import type { HealthRegistry } from "../services/health.js";
import { consoleLogger, type Logger } from "./logger.js";

export interface Open511PollerDeps {
  ctx: DbContext;
  redis?: RedisClient;
  open511Url: string;
  fetchFn?: FetchFn;
  llm?: LlmExtractor;
  log?: Logger;
  health?: HealthRegistry;
}

export interface PollResult {
  fetched: number;
  active: number;
  upserted: number;
  archived: number;
}

/** Assign a corridor segment to a point using nearest-line (KNN) search. */
async function nearestSegment(ctx: DbContext, lon: number, lat: number): Promise<SegmentId | null> {
  const rows = await ctx.sql<{ id: SegmentId }[]>`
    SELECT id FROM segments
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

/** Run a single Open511 poll cycle: fetch, cache, upsert, archive, reconcile. */
export async function runOpen511Poll(deps: Open511PollerDeps): Promise<PollResult> {
  const { ctx, redis, open511Url } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const llm = deps.llm ?? stubLlmExtractor;
  const log = deps.log ?? consoleLogger;
  const now = new Date();
  const nowIso = now.toISOString();

  const events = await fetchOpen511Events(open511Url, fetchFn);

  // Cache the raw response in Redis (best-effort).
  if (redis) {
    try {
      await redis.set(
        REDIS_KEYS.open511Raw,
        JSON.stringify({ fetchedAt: now.toISOString(), count: events.length, events }),
        "EX",
        300,
      );
    } catch (err) {
      log.warn("open511-poller: failed to cache raw response in Redis", err);
    }
  }

  const activeExternalIds: string[] = [];
  let upserted = 0;

  for (const event of events) {
    const normalized = normalizeEvent(event);
    if (!normalized) continue; // inactive or outside the corridor

    const segmentId = await nearestSegment(ctx, normalized.point[0], normalized.point[1]);
    if (!segmentId) continue;

    // LLM enrichment hook (stub): raw_text -> one-line summary. The Open511
    // `kind` stays the deterministic mapping from the structured road state.
    const extraction = normalized.rawText ? await llm.extract(normalized.rawText) : null;
    const summary = extraction?.summary ?? null;

    const upsertedRows = await ctx.sql<{ id: string }[]>`
      INSERT INTO reports
        (segment_id, source, kind, reporter_id, is_steward, external_id, raw_text, summary, confidence, geom, active, created_at, updated_at)
      VALUES
        (${segmentId}, 'open511', ${normalized.kind}, 'open511', false, ${normalized.externalId},
         ${normalized.rawText || null}, ${summary}, 'official',
         ST_SetSRID(ST_MakePoint(${normalized.point[0]}, ${normalized.point[1]}), 4326),
         true, ${normalized.createdAt.toISOString()}::timestamptz, ${nowIso}::timestamptz)
      ON CONFLICT (external_id) WHERE external_id IS NOT NULL
      DO UPDATE SET
        segment_id = EXCLUDED.segment_id,
        kind       = EXCLUDED.kind,
        raw_text   = EXCLUDED.raw_text,
        summary    = EXCLUDED.summary,
        geom       = EXCLUDED.geom,
        active     = true,
        updated_at = EXCLUDED.updated_at
      RETURNING id`;

    const reportId = upsertedRows[0]!.id;
    activeExternalIds.push(normalized.externalId);
    upserted += 1;

    const row = await ctx.db.select().from(reports).where(eq(reports.id, reportId));
    if (row[0]) await matchOrCreateIncident(ctx, row[0] as ReportRow, now);
  }

  // Archive Open511 reports whose events are no longer active, then close any
  // incidents left with no active supporting report. Split on the empty case to
  // avoid Postgres's "cannot determine type of empty array" on ANY('{}').
  const archivedRows =
    activeExternalIds.length > 0
      ? await ctx.sql<{ id: string }[]>`
          UPDATE reports SET active = false, updated_at = ${nowIso}::timestamptz
          WHERE source = 'open511' AND active = true
            AND NOT (external_id = ANY(${activeExternalIds}))
          RETURNING id`
      : await ctx.sql<{ id: string }[]>`
          UPDATE reports SET active = false, updated_at = ${nowIso}::timestamptz
          WHERE source = 'open511' AND active = true
          RETURNING id`;

  await ctx.sql`
    UPDATE incidents SET active = false, ended_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz
    WHERE active = true
      AND NOT EXISTS (
        SELECT 1 FROM reports r WHERE r.incident_id = incidents.id AND r.active = true
      )`;

  await reconcile(ctx, { cause: "open511-poll", actor: "open511-poller", now });
  await bustStatusCache(redis);

  const result: PollResult = {
    fetched: events.length,
    active: activeExternalIds.length,
    upserted,
    archived: archivedRows.length,
  };
  log.info(
    `open511-poller: fetched=${result.fetched} active=${result.active} upserted=${result.upserted} archived=${result.archived}`,
  );
  return result;
}

/** Start the recurring poller. Returns a stop function. */
export function startOpen511Poller(deps: Open511PollerDeps, intervalMs: number): () => void {
  const log = deps.log ?? consoleLogger;
  const health = deps.health;
  health?.register("open511-poller");
  let running = false;

  const tick = async () => {
    if (running) return; // avoid overlapping polls
    running = true;
    health?.markStart("open511-poller");
    try {
      const r = await runOpen511Poll(deps);
      health?.markSuccess("open511-poller", `fetched=${r.fetched} active=${r.active} archived=${r.archived}`);
    } catch (err) {
      log.error("open511-poller: poll failed", err);
      health?.markError("open511-poller", err);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
