// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { and, eq } from "drizzle-orm";
import {
  deriveStatus,
  type Confidence,
  type CorridorStatus,
  type ReportKind,
  type StatusLevel,
  type StewardOverride,
} from "@nissegroup/shared";
import type { DbContext } from "../db/client.js";
import {
  incidents,
  reports,
  segmentStatus,
  statusChanges,
  stewardOverrides,
  type ReportRow,
} from "../db/schema.js";
import { partitionReports, sourceToStatusSource } from "../domain/mapping.js";

/** Reports/incidents are grouped together only if they occur within this span. */
const INCIDENT_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 hours
/** Reports/incidents are considered co-located within this distance (metres). */
const PROXIMITY_METRES = 3000;

function kindToStatus(kind: ReportKind): Exclude<StatusLevel, "OPEN"> {
  return kind === "closure" ? "CLOSED" : "PARTIAL";
}

function defaultConfidence(source: ReportRow["source"], isSteward: boolean): Confidence {
  if (source === "open511") return "official";
  if (source === "steward" || isSteward) return "confirmed";
  return "unconfirmed";
}

export interface ReconcileOptions {
  cause: string;
  actor: string;
  now?: Date;
}

/**
 * Match a single report to an existing open incident (same segment + type +
 * proximity + time window) or open a new one, and link the report to it.
 *
 * A 'clear' report ends the active incidents on its segment instead of creating
 * one. Returns the incident id the report was attached to, or null.
 */
export async function matchOrCreateIncident(
  ctx: DbContext,
  reportRow: ReportRow,
  now: Date = new Date(),
): Promise<string | null> {
  if (reportRow.kind === "clear") {
    await ctx.db
      .update(incidents)
      .set({ active: false, endedAt: now, updatedAt: now })
      .where(and(eq(incidents.segmentId, reportRow.segmentId), eq(incidents.active, true)));
    return null;
  }

  const status = kindToStatus(reportRow.kind);
  const source = sourceToStatusSource(reportRow.source);
  const confidence = defaultConfidence(reportRow.source, reportRow.isSteward);
  const windowStart = new Date(now.getTime() - INCIDENT_WINDOW_MS);

  // Try to find a compatible open incident. Proximity is only enforced when
  // both the incident and the report carry a geometry.
  const matches = await ctx.sql<{ id: string }[]>`
    SELECT i.id
    FROM incidents i
    WHERE i.segment_id = ${reportRow.segmentId}
      AND i.kind = ${reportRow.kind}
      AND i.active = true
      AND i.updated_at >= ${windowStart.toISOString()}::timestamptz
      AND (
        i.geom IS NULL
        OR NOT EXISTS (SELECT 1 FROM reports r WHERE r.id = ${reportRow.id} AND r.geom IS NOT NULL)
        OR ST_DWithin(
             i.geom::geography,
             (SELECT r.geom FROM reports r WHERE r.id = ${reportRow.id})::geography,
             ${PROXIMITY_METRES}
           )
      )
    ORDER BY i.updated_at DESC
    LIMIT 1`;

  let incidentId: string;
  if (matches.length > 0 && matches[0]) {
    incidentId = matches[0].id;
    await ctx.db
      .update(incidents)
      .set({ updatedAt: now, active: true })
      .where(eq(incidents.id, incidentId));
  } else {
    const created = await ctx.sql<{ id: string }[]>`
      INSERT INTO incidents (segment_id, kind, status, source, confidence, summary, geom, started_at, active, created_at, updated_at)
      SELECT ${reportRow.segmentId}, ${reportRow.kind}, ${status}, ${source}, ${confidence},
             ${reportRow.summary ?? null}, r.geom,
             ${reportRow.createdAt.toISOString()}::timestamptz, true,
             ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz
      FROM reports r WHERE r.id = ${reportRow.id}
      RETURNING id`;
    incidentId = created[0]!.id;
  }

  await ctx.db.update(reports).set({ incidentId }).where(eq(reports.id, reportRow.id));
  return incidentId;
}

/**
 * Recompute corridor + per-segment status from all active reports/events via
 * the deterministic `deriveStatus`, persist `segment_status`, and append a
 * `status_changes` audit row on every flip.
 */
export async function reconcile(
  ctx: DbContext,
  options: ReconcileOptions,
): Promise<CorridorStatus> {
  const now = options.now ?? new Date();

  const activeRows = await ctx.db.select().from(reports).where(eq(reports.active, true));
  const { officialEvents, reports: sharedReports } = partitionReports(activeRows);

  // Active steward overrides feed deriveStatus rule 6 (an override wins and
  // records its reason, which is shown publicly).
  const overrideRows = await ctx.db
    .select()
    .from(stewardOverrides)
    .where(eq(stewardOverrides.active, true));
  const overrides: StewardOverride[] = overrideRows.map((o) => ({
    id: o.id,
    segmentId: o.segmentId,
    status: o.status,
    reason: o.reason,
    stewardId: o.stewardId,
    createdAt: o.createdAt.toISOString(),
    expiresAt: o.expiresAt ? o.expiresAt.toISOString() : null,
  }));

  // Rule 8 upheld: no CommunityRequest data is passed to deriveStatus.
  const corridor = deriveStatus(sharedReports, officialEvents, overrides, now);

  for (const segment of corridor.segments) {
    const prev = await ctx.db
      .select()
      .from(segmentStatus)
      .where(eq(segmentStatus.segmentId, segment.segmentId));
    const prevStatus = prev[0]?.status ?? null;

    if (prevStatus !== segment.status) {
      await ctx.db.insert(statusChanges).values({
        segmentId: segment.segmentId,
        fromState: prevStatus,
        toState: segment.status,
        cause: options.cause,
        actor: options.actor,
        reason: segment.reason ?? null,
        createdAt: now,
      });
    }

    await ctx.db
      .insert(segmentStatus)
      .values({
        segmentId: segment.segmentId,
        status: segment.status,
        source: segment.source,
        confidence: segment.confidence,
        reason: segment.reason ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: segmentStatus.segmentId,
        set: {
          status: segment.status,
          source: segment.source,
          confidence: segment.confidence,
          reason: segment.reason ?? null,
          updatedAt: now,
        },
      });
  }

  return corridor;
}
