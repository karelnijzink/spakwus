// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { ReactNode } from "react";
import { brand } from "@nissegroup/shared";
import { useHealth } from "../api/queries.js";
import { PeakRule } from "../components/Decorations.js";
import { clockTime, timeAgo } from "../lib/time.js";
import type { HealthReport } from "../api/types.js";

function Dot({ ok }: { ok: boolean }) {
  return <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-open" : "bg-closed"}`} />;
}

function StatusPill({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
        ok ? "bg-open-bg text-open" : "bg-closed-bg text-closed"
      }`}
    >
      <Dot ok={ok} />
      {label ?? (ok ? "OK" : "Down")}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-edge py-2.5 last:border-b-0">
      <span className="text-sm text-ink-2">{label}</span>
      <span className="text-right text-sm text-ink">{children}</span>
    </div>
  );
}

const WORKER_LABELS: Record<string, string> = {
  "open511-poller": "DriveBC / Open511 poller",
  "webcam-fetcher": "Webcam fetcher",
  notifier: "Alert notifier",
  "request-expirer": "Community board cleaner",
  "snapshot-publisher": "Static fallback publisher",
};

function ageLabel(ageSec: number | null): string {
  if (ageSec === null) return "never";
  if (ageSec < 90) return `${ageSec}s ago`;
  return timeAgo(new Date(Date.now() - ageSec * 1000).toISOString());
}

function Report({ report }: { report: HealthReport }) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-edge bg-paper-raised p-5">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg text-ink">Overall</p>
          <StatusPill ok={report.ok} label={report.ok ? "Operational" : "Degraded"} />
        </div>
        {!report.workersEnabled && (
          <p className="mt-2 text-xs text-ink-3">Background workers are disabled on this instance.</p>
        )}
        <div className="mt-3">
          <Row label="Database">
            <StatusPill ok={report.dependencies.database.ok} />
          </Row>
          <Row label="Cache (Redis)">
            <StatusPill ok={report.dependencies.redis.ok} label={report.dependencies.redis.ok ? "OK" : "Off"} />
          </Row>
          <Row label="Booted">{timeAgo(report.bootedAt)}</Row>
        </div>
      </div>

      <div className="rounded-2xl border border-edge bg-paper-raised p-5">
        <p className="font-display text-lg text-ink">DriveBC / Open511 freshness</p>
        <div className="mt-3">
          <Row label="Last successful poll">
            <span className="inline-flex items-center gap-2">
              <Dot ok={report.open511.fresh} />
              {report.open511.lastSuccessfulPollAt ? clockTime(report.open511.lastSuccessfulPollAt) : "—"}
              <span className="text-ink-3">({ageLabel(report.open511.ageSec)})</span>
            </span>
          </Row>
          <Row label="Newest event held">
            {report.open511.lastEventUpdatedAt ? timeAgo(report.open511.lastEventUpdatedAt) : "no active events"}
          </Row>
          <Row label="Freshness threshold">{Math.round(report.open511.staleThresholdSec / 60)} min</Row>
        </div>
      </div>

      <div className="rounded-2xl border border-edge bg-paper-raised p-5">
        <p className="font-display text-lg text-ink">Workers</p>
        <div className="mt-3">
          {report.workers.map((w) => (
            <Row key={w.name} label={WORKER_LABELS[w.name] ?? w.name}>
              <span className="inline-flex items-center gap-2">
                <span className="text-ink-3">{w.lastSuccessAt ? ageLabel(w.ageSec) : "—"}</span>
                <StatusPill ok={w.ok} label={w.ok ? "OK" : w.stale ? "Stale" : "Error"} />
              </span>
            </Row>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-3">
          Community board self-cleaning is {report.community.expirerHealthy ? "healthy" : "not running"}.
        </p>
      </div>

      <p className="text-center text-xs text-ink-3">
        Auto-refreshes every 15s · as of {clockTime(report.now)}
      </p>
    </div>
  );
}

export function Health() {
  const { data, isLoading, isError } = useHealth();
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-eyebrow text-ink-3">System status</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">Health &amp; freshness</h1>
        <PeakRule className="mt-3 h-5 w-44 text-pine" />
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          Live status of the {brand.productName} backend — data freshness and the workers that
          keep conditions current. Public and unauthenticated.
        </p>
      </div>

      {isLoading && <p className="text-sm text-ink-3">Checking…</p>}
      {isError && !data && (
        <div className="rounded-2xl border border-closed/20 bg-closed-bg/60 p-5">
          <p className="font-display text-lg text-closed">Backend unreachable</p>
          <p className="mt-1.5 text-sm text-ink-2">
            The status API did not respond. The corridor page still shows the last confirmed
            conditions from the static fallback.
          </p>
        </div>
      )}
      {data && <Report report={data} />}
    </div>
  );
}
