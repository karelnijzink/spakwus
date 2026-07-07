// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { Link } from "react-router-dom";
import { getSegment } from "@nissegroup/shared";
import { kindLabel, sourceLabel, statusStyle } from "../lib/status.js";
import { timeAgo } from "../lib/time.js";
import type { Incident } from "../api/types.js";
import { ConfidenceBadge } from "./ConfidenceBadge.js";
import { RequestCountBadge } from "./RequestCountBadge.js";

export function IncidentCard({ incident }: { incident: Incident }) {
  const style = statusStyle(incident.status);
  const location = getSegment(incident.segmentId)?.name ?? incident.segmentId;

  return (
    <Link
      to={`/incident/${incident.id}`}
      className={`block rounded-2xl border border-edge border-l-[3px] bg-paper-raised p-4 transition hover:border-ink-3/40 hover:shadow-[0_2px_16px_rgba(35,34,30,0.05)] ${style.accent}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg leading-tight text-ink">{kindLabel(incident.kind)}</p>
          <p className="text-sm text-ink-2">{location}</p>
        </div>
        <ConfidenceBadge confidence={incident.confidence} />
      </div>

      {incident.summary && (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-2">{incident.summary}</p>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-edge pt-2.5 text-[11px] text-ink-3">
        <span>
          {sourceLabel(incident.source)} · reported {timeAgo(incident.startedAt)}
        </span>
        {/* Count only — deep-links into the community board. Never request text. */}
        <RequestCountBadge incidentId={incident.id} count={incident.requestCount} asButton />
      </div>
    </Link>
  );
}
