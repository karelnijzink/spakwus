// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { lazy, Suspense } from "react";
import { useCorridorData } from "../offline/CorridorContext.js";
import { useIncidents } from "../api/queries.js";
import { DriveBcLink } from "../components/DriveBcLink.js";

// MapLibre is heavy; load it only when the Map page is opened. The chunk is
// still precached by Workbox so the map works offline once visited.
const CorridorMap = lazy(() =>
  import("../components/CorridorMap.js").then((m) => ({ default: m.CorridorMap })),
);

export function MapPage() {
  const { snapshot } = useCorridorData();
  const incidents = useIncidents(true).data?.incidents ?? [];
  const cams = snapshot?.webcams ?? [];

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] uppercase tracking-eyebrow text-ink-3">Sea to Sky corridor</p>
        <h1 className="mt-1 font-display text-2xl text-ink">The map</h1>
      </div>
      <div className="h-[68vh] overflow-hidden rounded-2xl border border-edge">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center font-display text-ink-3">
              Loading map…
            </div>
          }
        >
          <CorridorMap incidents={incidents} cams={cams} />
        </Suspense>
      </div>
      <p className="text-xs text-ink-3">
        Incident markers show live-reported conditions; camera markers are placed at
        approximate segment locations. Confirm with <DriveBcLink className="text-ink-2" />.
      </p>
    </div>
  );
}
