// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { Link, useParams } from "react-router-dom";
import { getSegment } from "@nissegroup/shared";
import { useIncident } from "../api/queries.js";
import { kindLabel, sourceLabel, statusStyle } from "../lib/status.js";
import { clockTime, timeAgo } from "../lib/time.js";
import { ConfidenceBadge } from "../components/ConfidenceBadge.js";
import { RequestCountBadge } from "../components/RequestCountBadge.js";
import { DriveBcLink } from "../components/DriveBcLink.js";

export function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const { incident, isLoading, isError } = useIncident(id);

  if (isLoading) {
    return <p className="py-16 text-center font-display text-lg text-ink-3">Loading incident…</p>;
  }
  if (isError || !incident) {
    return (
      <div className="space-y-3">
        <p className="rounded-2xl border border-edge bg-paper-raised p-4 text-sm text-ink-2">
          This incident could not be loaded. It may have cleared, or you may be offline.
        </p>
        <Link to="/" className="text-sm text-ink-2 underline decoration-edge underline-offset-2">
          ← Back to conditions
        </Link>
      </div>
    );
  }

  const style = statusStyle(incident.status);
  const location = getSegment(incident.segmentId)?.name ?? incident.segmentId;
  const timeline = [...incident.reports].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <div className="space-y-6">
      <Link to="/" className="text-sm text-ink-2 underline decoration-edge underline-offset-2 hover:decoration-ink-3">
        ← Back to conditions
      </Link>

      <section className={`overflow-hidden rounded-2xl border border-edge border-l-[3px] bg-paper-raised ${style.accent}`}>
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-eyebrow text-ink-3">{location}</p>
              <h1 className="mt-1 font-display text-2xl text-ink">{kindLabel(incident.kind)}</h1>
            </div>
            <ConfidenceBadge confidence={incident.confidence} />
          </div>
          {incident.summary && <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{incident.summary}</p>}
          <p className="mt-3 text-xs text-ink-3">
            {sourceLabel(incident.source)} · started {timeAgo(incident.startedAt)}
            {incident.active ? "" : " · cleared"}
          </p>
          {incident.requestCount > 0 && (
            <div className="mt-3">
              <RequestCountBadge incidentId={incident.id} count={incident.requestCount} />
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-eyebrow text-ink-3">
          Report timeline
        </h2>
        <ol className="relative space-y-5 border-l border-edge pl-5">
          {timeline.map((report) => (
            <li key={report.id} className="relative">
              <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full bg-pine" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-base text-ink">{kindLabel(report.kind)}</span>
                {report.confidence && <ConfidenceBadge confidence={report.confidence} />}
                {report.isSteward && (
                  <span className="rounded-full bg-pine px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-paper">
                    Steward
                  </span>
                )}
              </div>
              {report.summary && <p className="mt-1 text-sm leading-relaxed text-ink-2">{report.summary}</p>}
              <p className="mt-1 text-[11px] text-ink-3">
                {sourceLabel(report.source)} · {clockTime(report.createdAt)} · {timeAgo(report.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <p className="border-t border-edge pt-5 text-xs text-ink-3">
        Provenance shown for every report. This is community and official information, not
        an official ruling — confirm with <DriveBcLink className="text-ink-2" />.
      </p>
    </div>
  );
}
