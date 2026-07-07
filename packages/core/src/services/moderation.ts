// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { and, eq } from "drizzle-orm";
import type { SegmentId, StatusLevel } from "@nissegroup/shared";
import type { DbContext } from "../db/client.js";
import { auditLog, reports, stewardOverrides } from "../db/schema.js";
import { reconcile } from "./reconciler.js";

async function audit(
  ctx: DbContext,
  actor: string,
  action: string,
  targetType: string,
  targetId: string | null,
  reason: string | null,
  now: Date,
): Promise<void> {
  await ctx.db.insert(auditLog).values({ actor, action, targetType, targetId, reason, createdAt: now });
}

/** Close any incidents that no longer have an active supporting report. */
async function closeOrphanIncidents(ctx: DbContext, now: Date): Promise<void> {
  await ctx.sql`
    UPDATE incidents SET active = false, ended_at = ${now.toISOString()}::timestamptz, updated_at = ${now.toISOString()}::timestamptz
    WHERE active = true
      AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.incident_id = incidents.id AND r.active = true)`;
}

/**
 * Verify a report: the steward vouches for it, so it is treated as a steward-
 * trust report by deriveStatus (it can now corroborate/flip on its own).
 */
export async function verifyReport(ctx: DbContext, reportId: string, stewardId: string): Promise<boolean> {
  const now = new Date();
  const updated = await ctx.db
    .update(reports)
    .set({ isSteward: true, trustLevel: "steward", moderationState: "verified", active: true, updatedAt: now })
    .where(eq(reports.id, reportId))
    .returning({ id: reports.id });
  if (updated.length === 0) return false;
  await audit(ctx, stewardId, "report.verify", "report", reportId, null, now);
  await reconcile(ctx, { cause: "moderation:verify", actor: stewardId, now });
  return true;
}

/** Dismiss a report: excluded from status derivation; its incident may close. */
export async function dismissReport(
  ctx: DbContext,
  reportId: string,
  stewardId: string,
  reason?: string,
): Promise<boolean> {
  const now = new Date();
  const updated = await ctx.db
    .update(reports)
    .set({ active: false, moderationState: "dismissed", updatedAt: now })
    .where(eq(reports.id, reportId))
    .returning({ id: reports.id });
  if (updated.length === 0) return false;
  await closeOrphanIncidents(ctx, now);
  await audit(ctx, stewardId, "report.dismiss", "report", reportId, reason ?? null, now);
  await reconcile(ctx, { cause: "moderation:dismiss", actor: stewardId, now });
  return true;
}

/** Merge reports into a target incident (dedupe display; they still corroborate). */
export async function mergeReports(
  ctx: DbContext,
  reportIds: string[],
  targetIncidentId: string,
  stewardId: string,
): Promise<number> {
  const now = new Date();
  let merged = 0;
  for (const id of reportIds) {
    const updated = await ctx.db
      .update(reports)
      .set({ incidentId: targetIncidentId, moderationState: "merged", updatedAt: now })
      .where(eq(reports.id, id))
      .returning({ id: reports.id });
    merged += updated.length;
  }
  await closeOrphanIncidents(ctx, now);
  await audit(ctx, stewardId, "report.merge", "incident", targetIncidentId, `merged ${merged} report(s)`, now);
  await reconcile(ctx, { cause: "moderation:merge", actor: stewardId, now });
  return merged;
}

export interface CreateOverrideInput {
  segmentId: SegmentId;
  status: StatusLevel;
  reason: string;
  expiresAt?: string | null;
}

/** Create a manual steward override (reason required; shown publicly). */
export async function createOverride(
  ctx: DbContext,
  input: CreateOverrideInput,
  stewardId: string,
): Promise<{ id: string }> {
  const now = new Date();
  // Supersede any existing active override on the same segment.
  await ctx.db
    .update(stewardOverrides)
    .set({ active: false, clearedAt: now })
    .where(and(eq(stewardOverrides.segmentId, input.segmentId), eq(stewardOverrides.active, true)));

  const [row] = await ctx.db
    .insert(stewardOverrides)
    .values({
      segmentId: input.segmentId,
      status: input.status,
      reason: input.reason,
      stewardId,
      active: true,
      createdAt: now,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    })
    .returning({ id: stewardOverrides.id });

  await audit(ctx, stewardId, "override.create", "segment", input.segmentId, `${input.status}: ${input.reason}`, now);
  await reconcile(ctx, { cause: "override", actor: stewardId, now });
  return { id: row!.id };
}

/** Clear an active override. */
export async function clearOverride(ctx: DbContext, overrideId: string, stewardId: string): Promise<boolean> {
  const now = new Date();
  const updated = await ctx.db
    .update(stewardOverrides)
    .set({ active: false, clearedAt: now })
    .where(eq(stewardOverrides.id, overrideId))
    .returning({ segmentId: stewardOverrides.segmentId });
  if (updated.length === 0) return false;
  await audit(ctx, stewardId, "override.clear", "override", overrideId, null, now);
  await reconcile(ctx, { cause: "override-clear", actor: stewardId, now });
  return true;
}
