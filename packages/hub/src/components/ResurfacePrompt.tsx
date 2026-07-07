// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { useEffect, useState } from "react";
import type { SegmentId, StatusLevel } from "@nissegroup/shared";
import { useResurface } from "../offline/useResurface.js";
import { useCorridorData } from "../offline/CorridorContext.js";
import { segmentForLatLon } from "../lib/corridorGeo.js";
import { ReportForm } from "./ReportForm.js";

const RANK: Record<StatusLevel, number> = { OPEN: 0, PARTIAL: 1, CLOSED: 2 };

/**
 * When the app comes back online after a stretch offline, ask the user — who
 * likely just drove the corridor — whether they have anything to report,
 * prefilled with the segment they most likely just travelled.
 */
export function ResurfacePrompt() {
  const { prompted, dismiss } = useResurface();
  const { snapshot } = useCorridorData();
  const [likely, setLikely] = useState<SegmentId | undefined>(undefined);

  // Best guess at the segment just travelled: geolocation if allowed, else the
  // most notable (worst) segment on the corridor.
  useEffect(() => {
    if (!prompted) return;
    const worst = snapshot?.segments
      ? [...snapshot.segments].sort((a, b) => RANK[b.status] - RANK[a.status])[0]?.id
      : undefined;
    setLikely(worst);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLikely(segmentForLatLon(pos.coords.latitude, pos.coords.longitude)),
        () => {},
        { timeout: 6000 },
      );
    }
  }, [prompted, snapshot]);

  if (!prompted) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/30 p-3 sm:items-center">
      <div className="w-full max-w-md rounded-2xl border border-edge bg-paper shadow-xl">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <p className="text-[11px] uppercase tracking-eyebrow text-ink-3">Welcome back online</p>
            <h2 className="mt-1 font-display text-xl text-ink">You just came through.</h2>
            <p className="mt-1 text-sm text-ink-2">Anything to report while it's fresh?</p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="rounded-full px-2 py-1 text-ink-3 hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="p-4">
          <ReportForm defaultSegmentId={likely} onDone={dismiss} />
        </div>
      </div>
    </div>
  );
}
