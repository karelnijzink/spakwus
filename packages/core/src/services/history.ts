// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { SegmentId } from "@nissegroup/shared";
import type { DbContext } from "../db/client.js";

/**
 * Historical corridor incident stats, computed from `historical_events` (loaded
 * from DriveBC historical event CSVs by `scripts/load-history.ts`). This is a
 * retrospective analytics view only — it never feeds `deriveStatus` or the live
 * status surface.
 */

export interface MonthlyClosures {
  month: string; // YYYY-MM
  closures: number;
  events: number;
}

export interface SegmentHistory {
  segmentId: SegmentId;
  name: string | null;
  events: number;
  closures: number;
  medianClosureMinutes: number | null;
}

export interface DurationStats {
  medianMinutes: number | null;
  p90Minutes: number | null;
  avgMinutes: number | null;
  sampleSize: number;
}

export interface HistoryStats {
  coverage: { since: string | null; until: string | null; totalEvents: number; totalClosures: number };
  closuresByMonth: MonthlyClosures[];
  worstSegments: SegmentHistory[];
  typicalClosureDuration: DurationStats;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export async function getHistoryStats(ctx: DbContext): Promise<HistoryStats> {
  const coverageRows = await ctx.sql<
    { total_events: number; total_closures: number; since: Date | string | null; until: Date | string | null }[]
  >`
    SELECT count(*)::int AS total_events,
           count(*) FILTER (WHERE is_closure)::int AS total_closures,
           min(started_at) AS since,
           max(COALESCE(ended_at, started_at)) AS until
    FROM historical_events`;
  const cov = coverageRows[0];

  const monthlyRows = await ctx.sql<{ month: string; closures: number; events: number }[]>`
    SELECT to_char(date_trunc('month', started_at), 'YYYY-MM') AS month,
           count(*) FILTER (WHERE is_closure)::int AS closures,
           count(*)::int AS events
    FROM historical_events
    WHERE started_at IS NOT NULL
    GROUP BY 1
    ORDER BY 1`;

  const segmentRows = await ctx.sql<
    { segment_id: SegmentId; name: string | null; events: number; closures: number; median_minutes: number | null }[]
  >`
    SELECT he.segment_id,
           s.name,
           count(*)::int AS events,
           count(*) FILTER (WHERE he.is_closure)::int AS closures,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY he.duration_minutes)
             FILTER (WHERE he.is_closure AND he.duration_minutes IS NOT NULL) AS median_minutes
    FROM historical_events he
    LEFT JOIN segments s ON s.id = he.segment_id
    WHERE he.segment_id IS NOT NULL
    GROUP BY he.segment_id, s.name
    ORDER BY closures DESC, events DESC`;

  const durationRows = await ctx.sql<
    { median: number | null; p90: number | null; avg: number | null; n: number }[]
  >`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_minutes) AS median,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_minutes) AS p90,
           avg(duration_minutes) AS avg,
           count(*)::int AS n
    FROM historical_events
    WHERE is_closure = true AND duration_minutes IS NOT NULL`;
  const dur = durationRows[0];

  return {
    coverage: {
      since: cov?.since ? new Date(cov.since).toISOString() : null,
      until: cov?.until ? new Date(cov.until).toISOString() : null,
      totalEvents: cov?.total_events ?? 0,
      totalClosures: cov?.total_closures ?? 0,
    },
    closuresByMonth: monthlyRows.map((r) => ({ month: r.month, closures: r.closures, events: r.events })),
    worstSegments: segmentRows.map((r) => ({
      segmentId: r.segment_id,
      name: r.name,
      events: r.events,
      closures: r.closures,
      medianClosureMinutes: num(r.median_minutes),
    })),
    typicalClosureDuration: {
      medianMinutes: num(dur?.median),
      p90Minutes: num(dur?.p90),
      avgMinutes: num(dur?.avg),
      sampleSize: dur?.n ?? 0,
    },
  };
}
