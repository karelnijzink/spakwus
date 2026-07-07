// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { brand } from "@nissegroup/shared";
import { useHistoryStats } from "../api/queries.js";
import { PeakRule } from "../components/Decorations.js";
import type { HistoryStatsResponse } from "../api/types.js";

function fmtDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtMonth(month: string): string {
  const [y, m] = month.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString([], { month: "short", year: "2-digit" });
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-edge bg-paper-raised p-4 text-center">
      <p className="font-display text-2xl text-ink">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wide text-ink-3">{label}</p>
    </div>
  );
}

function MonthlyChart({ data }: { data: HistoryStatsResponse["closuresByMonth"] }) {
  const recent = data.slice(-24);
  const max = Math.max(1, ...recent.map((d) => d.closures));
  return (
    <div className="rounded-2xl border border-edge bg-paper-raised p-5">
      <p className="font-display text-lg text-ink">Closures per month</p>
      <div className="mt-4 flex h-40 items-stretch gap-1">
        {recent.map((d) => (
          <div
            key={d.month}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${d.month}: ${d.closures} closures`}
          >
            <div
              className="w-full rounded-t bg-closed/80"
              style={{ height: `${Math.max((d.closures / max) * 100, d.closures > 0 ? 4 : 0)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {recent.map((d, i) => (
          <div key={d.month} className="flex-1 text-center text-[9px] text-ink-3">
            {i % 3 === 0 ? fmtMonth(d.month) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function WorstSegments({ data }: { data: HistoryStatsResponse["worstSegments"] }) {
  const max = Math.max(1, ...data.map((s) => s.closures));
  return (
    <div className="rounded-2xl border border-edge bg-paper-raised p-5">
      <p className="font-display text-lg text-ink">Worst segments</p>
      <div className="mt-4 space-y-3">
        {data.map((s) => (
          <div key={s.segmentId}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-ink">{s.name ?? s.segmentId}</span>
              <span className="text-ink-3">
                {s.closures} closures · median {fmtDuration(s.medianClosureMinutes)}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-edge">
              <div className="h-full rounded-full bg-closed/80" style={{ width: `${(s.closures / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function History() {
  const { data, isLoading, isError } = useHistoryStats();
  const empty = data && data.coverage.totalEvents === 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-eyebrow text-ink-3">History</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">Corridor incident history</h1>
        <PeakRule className="mt-3 h-5 w-44 text-pine" />
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          Retrospective stats from historical DriveBC events on Highway&nbsp;99. This is a
          look back — it never affects the live status shown elsewhere in {brand.productName}.
        </p>
      </div>

      {isLoading && <p className="text-sm text-ink-3">Loading…</p>}
      {isError && <p className="text-sm text-ink-3">Historical stats are unavailable right now.</p>}

      {empty && (
        <div className="rounded-2xl border border-edge bg-paper-raised p-5">
          <p className="text-sm text-ink-2">
            No historical data has been loaded yet. The operator can backfill it from DriveBC
            event exports.
          </p>
        </div>
      )}

      {data && !empty && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat value={String(data.coverage.totalClosures)} label="Closures" />
            <Stat value={String(data.coverage.totalEvents)} label="Events" />
            <Stat value={fmtDuration(data.typicalClosureDuration.medianMinutes)} label="Median closure" />
            <Stat value={fmtDuration(data.typicalClosureDuration.p90Minutes)} label="90th percentile" />
          </div>

          <MonthlyChart data={data.closuresByMonth} />
          <WorstSegments data={data.worstSegments} />

          <p className="text-center text-xs text-ink-3">
            {data.coverage.since && data.coverage.until
              ? `Covers ${new Date(data.coverage.since).getFullYear()}–${new Date(
                  data.coverage.until,
                ).getFullYear()}. `
              : ""}
            Source: DriveBC historical events.
          </p>
        </>
      )}
    </div>
  );
}
