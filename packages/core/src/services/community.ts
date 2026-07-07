// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

//
// COMMUNITY PLANE. None of this is ever read by deriveStatus — community
// requests can never change corridor or segment status. The only thing the
// status surface may show is a count (see queries.ts getRequestCount).
//

import { eq, sql } from "drizzle-orm";
import type {
  CommunityRequestCategory,
  CommunityRequestKind,
  CommunityRequestStatus,
  ContactMethod,
  SegmentId,
} from "@nissegroup/shared";
import type { DbContext } from "../db/client.js";
import { auditLog, communityRequests, requestResponses, type IncidentType } from "../db/schema.js";
import type { RedisClient } from "../redis/client.js";
import { rateLimit } from "../redis/client.js";
import type { Config } from "../config.js";
import { submitReport } from "./reports.js";
import type { LlmExtractor } from "./llm.js";

// Community posts are ephemeral: they disappear from the board 48h after posting
// (or sooner if the linked incident clears). The expirer worker enforces this.
const DEFAULT_TTL_HOURS = 48;
const MAX_TTL_HOURS = 48;
const FLAG_AUTO_REMOVE = 5;

export interface CommunityDeps {
  ctx: DbContext;
  redis?: RedisClient;
  config: Config;
  ip: string;
}

async function checkRate(deps: CommunityDeps, token: string | undefined, kind: string): Promise<boolean> {
  if (!deps.redis) return true;
  const ip = await rateLimit(deps.redis, `req:${kind}:ip:${deps.ip}`, deps.config.REPORT_RATE_MAX_IP, deps.config.REPORT_RATE_WINDOW_SEC);
  if (!ip.allowed) return false;
  if (token) {
    const tok = await rateLimit(deps.redis, `req:${kind}:tok:${token}`, deps.config.REPORT_RATE_MAX_TOKEN, deps.config.REPORT_RATE_WINDOW_SEC);
    if (!tok.allowed) return false;
  }
  return true;
}

async function nearestSegment(ctx: DbContext, lon: number, lat: number): Promise<SegmentId | null> {
  const rows = await ctx.sql<{ id: SegmentId }[]>`
    SELECT id FROM segments ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326) LIMIT 1`;
  return rows[0]?.id ?? null;
}

/** Most severe active incident on a segment, to auto-link a request at creation. */
async function activeIncidentOnSegment(ctx: DbContext, segmentId: SegmentId): Promise<string | null> {
  const rows = await ctx.sql<{ id: string }[]>`
    SELECT id FROM incidents
    WHERE segment_id = ${segmentId} AND active = true
    ORDER BY (CASE status WHEN 'CLOSED' THEN 2 WHEN 'PARTIAL' THEN 1 ELSE 0 END) DESC, started_at DESC
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

export interface CreateRequestInput {
  kind: CommunityRequestKind;
  category: CommunityRequestCategory;
  segmentId?: SegmentId;
  lat?: number;
  lng?: number;
  locationDesc?: string;
  body: string;
  contactMethod: ContactMethod;
  contactValue?: string;
  ttlHours?: number;
  deviceToken?: string;
  /** Optional: notify the requester when someone responds (separate from status alerts). */
  notifyChannel?: string;
  notifyTarget?: string;
}

export type CreateRequestResult =
  | { ok: true; request: { id: string; segmentId: SegmentId; incidentId: string | null; expiresAt: string } }
  | { ok: false; error: "rate_limited" | "bad_location"; message: string };

export async function createRequest(input: CreateRequestInput, deps: CommunityDeps): Promise<CreateRequestResult> {
  const { ctx } = deps;
  if (!(await checkRate(deps, input.deviceToken, "create"))) {
    return { ok: false, error: "rate_limited", message: "You're posting a lot. Try again shortly." };
  }

  let segmentId: SegmentId | null = input.segmentId ?? null;
  const hasGeo = typeof input.lat === "number" && typeof input.lng === "number";
  if (!segmentId && hasGeo) segmentId = await nearestSegment(ctx, input.lng!, input.lat!);
  if (!segmentId) return { ok: false, error: "bad_location", message: "A segment or map location is required." };

  const incidentId = await activeIncidentOnSegment(ctx, segmentId);
  const ttl = Math.min(Math.max(input.ttlHours ?? DEFAULT_TTL_HOURS, 1), MAX_TTL_HOURS);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 3_600_000);
  const contactMethod = input.contactMethod;
  const contactValue = contactMethod === "phone" ? (input.contactValue ?? null) : null;
  const createdBy = input.deviceToken ?? "anon";

  const notifyChannel = input.notifyChannel ?? null;
  const notifyTarget = input.notifyTarget ?? null;
  const inserted = hasGeo
    ? await ctx.sql<{ id: string }[]>`
        INSERT INTO community_requests
          (kind, category, segment_id, incident_id, geom, location_desc, body, contact_method, contact_value, status, created_by, notify_channel, notify_target, created_at, expires_at)
        VALUES
          (${input.kind}, ${input.category}, ${segmentId}, ${incidentId}, ST_SetSRID(ST_MakePoint(${input.lng!}, ${input.lat!}), 4326),
           ${input.locationDesc ?? null}, ${input.body}, ${contactMethod}, ${contactValue}, 'open', ${createdBy}, ${notifyChannel}, ${notifyTarget},
           ${now.toISOString()}::timestamptz, ${expiresAt.toISOString()}::timestamptz)
        RETURNING id`
    : await ctx.sql<{ id: string }[]>`
        INSERT INTO community_requests
          (kind, category, segment_id, incident_id, location_desc, body, contact_method, contact_value, status, created_by, notify_channel, notify_target, created_at, expires_at)
        VALUES
          (${input.kind}, ${input.category}, ${segmentId}, ${incidentId}, ${input.locationDesc ?? null}, ${input.body},
           ${contactMethod}, ${contactValue}, 'open', ${createdBy}, ${notifyChannel}, ${notifyTarget},
           ${now.toISOString()}::timestamptz, ${expiresAt.toISOString()}::timestamptz)
        RETURNING id`;

  return {
    ok: true,
    request: { id: inserted[0]!.id, segmentId, incidentId, expiresAt: expiresAt.toISOString() },
  };
}

export async function addResponse(
  requestId: string,
  body: string,
  responderRef: string,
  deps: CommunityDeps,
): Promise<{ ok: boolean; error?: string; notify?: { channel: string; target: string; body: string } }> {
  if (!(await checkRate(deps, responderRef, "respond"))) return { ok: false, error: "rate_limited" };
  const req = await deps.ctx.db.select().from(communityRequests).where(eq(communityRequests.id, requestId));
  if (!req[0] || req[0].removedAt || req[0].status !== "open") return { ok: false, error: "not_open" };
  await deps.ctx.db.insert(requestResponses).values({ requestId, body, responderRef });
  const r = req[0];
  return {
    ok: true,
    ...(r.notifyChannel && r.notifyTarget
      ? { notify: { channel: r.notifyChannel, target: r.notifyTarget, body: r.body } }
      : {}),
  };
}

/** Requester marks their own request matched or resolved. */
export async function updateRequestStatus(
  ctx: DbContext,
  requestId: string,
  status: Extract<CommunityRequestStatus, "matched" | "resolved">,
  deviceToken: string,
): Promise<{ ok: boolean; error?: string }> {
  const req = await ctx.db.select().from(communityRequests).where(eq(communityRequests.id, requestId));
  if (!req[0]) return { ok: false, error: "not_found" };
  if (req[0].createdBy !== deviceToken) return { ok: false, error: "forbidden" };
  await ctx.db.update(communityRequests).set({ status }).where(eq(communityRequests.id, requestId));
  return { ok: true };
}

async function flag(ctx: DbContext, table: typeof communityRequests | typeof requestResponses, id: string): Promise<boolean> {
  const rows = await ctx.db
    .update(table)
    .set({ flagCount: sql`${table.flagCount} + 1` })
    .where(eq(table.id, id))
    .returning({ flagCount: table.flagCount });
  if (rows.length === 0) return false;
  if ((rows[0]!.flagCount ?? 0) >= FLAG_AUTO_REMOVE) {
    await ctx.db.update(table).set({ removedAt: new Date(), removedBy: "auto:flags" }).where(eq(table.id, id));
  }
  return true;
}

export async function flagRequest(deps: CommunityDeps, id: string): Promise<boolean> {
  if (!(await checkRate(deps, undefined, "flag"))) return false;
  return flag(deps.ctx, communityRequests, id);
}
export async function flagResponse(deps: CommunityDeps, id: string): Promise<boolean> {
  if (!(await checkRate(deps, undefined, "flag"))) return false;
  return flag(deps.ctx, requestResponses, id);
}

/** Steward removal (reuses Phase 3 moderation posture). */
export async function removeRequest(ctx: DbContext, id: string, stewardId: string): Promise<boolean> {
  const rows = await ctx.db
    .update(communityRequests)
    .set({ removedAt: new Date(), removedBy: stewardId })
    .where(eq(communityRequests.id, id))
    .returning({ id: communityRequests.id });
  if (rows.length === 0) return false;
  await ctx.db.insert(auditLog).values({
    actor: stewardId,
    action: "request.remove",
    targetType: "community_request",
    targetId: id,
    reason: null,
  });
  return true;
}

export async function removeResponse(ctx: DbContext, id: string, stewardId: string): Promise<boolean> {
  const rows = await ctx.db
    .update(requestResponses)
    .set({ removedAt: new Date(), removedBy: stewardId })
    .where(eq(requestResponses.id, id))
    .returning({ id: requestResponses.id });
  if (rows.length === 0) return false;
  await ctx.db.insert(auditLog).values({
    actor: stewardId,
    action: "response.remove",
    targetType: "request_response",
    targetId: id,
    reason: null,
  });
  return true;
}

/**
 * OPTIONAL BRIDGE: a deliberate, explicit action turning an "info" community
 * request into a real status-plane incident report that flows through the
 * normal reconciler (subject to all the usual trust/corroboration rules). This
 * is the one sanctioned crossover; it never happens automatically.
 */
export async function escalateRequest(
  requestId: string,
  incidentType: IncidentType,
  note: string | undefined,
  deps: CommunityDeps & { llm?: LlmExtractor; deviceToken?: string },
): Promise<{ ok: boolean; error?: string; reportId?: string }> {
  const [req] = await deps.ctx.db.select().from(communityRequests).where(eq(communityRequests.id, requestId));
  if (!req || req.removedAt) return { ok: false, error: "not_found" };

  const result = await submitReport(
    {
      incidentType,
      segmentId: req.segmentId,
      note: note ?? req.body,
      deviceToken: deps.deviceToken,
    },
    { ctx: deps.ctx, redis: deps.redis, config: deps.config, llm: deps.llm, ip: deps.ip },
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, reportId: result.report.id };
}

/**
 * SELF-CLEANING worker step: expire requests whose TTL has passed or whose
 * linked incident has cleared, so the board never accumulates stale posts.
 */
export async function expireRequests(ctx: DbContext, now: Date = new Date()): Promise<number> {
  const rows = await ctx.sql<{ id: string }[]>`
    UPDATE community_requests SET status = 'expired'
    WHERE status = 'open'
      AND (
        expires_at <= ${now.toISOString()}::timestamptz
        OR (incident_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM incidents i WHERE i.id = community_requests.incident_id AND i.active = true
        ))
      )
    RETURNING id`;
  return rows.length;
}
