// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { useState } from "react";
import { getSegment, type StatusLevel } from "@nissegroup/shared";
import { useCorridorData } from "../offline/CorridorContext.js";
import { useIncidents } from "../api/queries.js";
import type { Incident } from "../api/types.js";
import { StatusBanner } from "../components/StatusBanner.js";
import { SegmentStrip } from "../components/SegmentStrip.js";
import { IncidentCard } from "../components/IncidentCard.js";
import { WebcamThumb } from "../components/WebcamThumb.js";
import { CoverageNote } from "../components/CoverageNote.js";
import { ReportForm } from "../components/ReportForm.js";
import { PeakRule } from "../components/Decorations.js";
import { timeAgo } from "../lib/time.js";
import { HAS_BACKEND } from "../lib/features.js";

const LEVEL_RANK: Record<StatusLevel, number> = { OPEN: 0, PARTIAL: 1, CLOSED: 2 };

function pickPrimary(incidents: Incident[]): Incident | undefined {
  return [...incidents]
    .filter((i) => i.active && i.status !== "OPEN")
    .sort((a, b) => LEVEL_RANK[b.status] - LEVEL_RANK[a.status])[0];
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-eyebrow text-ink-3">
      {children}
    </h2>
  );
}

export function Home() {
  const { snapshot, isLoading, generatedAt } = useCorridorData();
  const incidentsQuery = useIncidents(true);
  const incidents = incidentsQuery.data?.incidents ?? [];
  const [reporting, setReporting] = useState(false);

  if (isLoading) {
    return <p className="py-16 text-center font-display text-lg text-ink-3">Loading conditions…</p>;
  }

  if (!snapshot) {
    return (
      <div className="rounded-2xl border border-edge bg-paper-raised p-8 text-center">
        <p className="font-display text-xl text-ink">No conditions available yet</p>
        <p className="mt-2 text-sm text-ink-2">
          You appear to be offline and no saved snapshot exists on this device.
          Reconnect to load the latest Sea to Sky conditions.
        </p>
      </div>
    );
  }

  const primary = pickPrimary(incidents);
  const primaryLocation = primary ? getSegment(primary.segmentId)?.name : undefined;

  return (
    <div className="space-y-8">
      <StatusBanner
        status={snapshot.corridor.status}
        updatedAt={snapshot.corridor.updatedAt}
        source={snapshot.corridor.source}
        reason={snapshot.corridor.reason}
        primaryIncident={primary}
        primaryLocation={primaryLocation}
      />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <SectionHeading>Along the corridor</SectionHeading>
          {HAS_BACKEND && (
            <button
              type="button"
              onClick={() => setReporting((v) => !v)}
              className="rounded-full bg-pine px-3 py-1.5 text-xs font-semibold text-paper"
            >
              {reporting ? "Close" : "＋ Report from the road"}
            </button>
          )}
        </div>
        {HAS_BACKEND && reporting && (
          <div className="mb-4">
            <ReportForm defaultSegmentId={primary?.segmentId} onDone={() => setReporting(false)} />
          </div>
        )}
        <SegmentStrip segments={snapshot.segments} />
      </section>

      {snapshot.webcams.length > 0 && (
        <section>
          <SectionHeading>Live cams</SectionHeading>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {snapshot.webcams.map((cam) => (
              <WebcamThumb key={cam.id} cam={cam} />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHeading>Latest incidents</SectionHeading>
        {incidents.length === 0 ? (
          <p className="rounded-2xl border border-edge bg-paper-raised p-4 text-sm text-ink-3">
            {incidentsQuery.isError
              ? "Incident details are unavailable offline."
              : "No active incidents reported on the corridor."}
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {incidents.map((incident) => (
              <IncidentCard key={incident.id} incident={incident} />
            ))}
          </div>
        )}
      </section>

      <div className="space-y-3 pt-2">
        <PeakRule className="h-5 w-40 text-pine" />
        <p className="text-xs text-ink-3">Conditions last updated {timeAgo(generatedAt)}.</p>
        <CoverageNote />
      </div>
    </div>
  );
}
