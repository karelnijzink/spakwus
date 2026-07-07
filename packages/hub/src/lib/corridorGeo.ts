// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { SegmentId } from "@nissegroup/shared";
import { HWY99_LINE } from "./hwy99.js";

/**
 * The corridor polyline is the real BC Highway 99 centreline (from OSM, baked
 * into hwy99.ts). Webcam markers — which the API does not carry coordinates for
 * — are placed on that centreline at the mid-latitude of their segment.
 */
export const CORRIDOR_LINE: [number, number][] = HWY99_LINE;

/** Approximate latitude band for each segment (south → north). */
const SEGMENT_LAT: Record<SegmentId, number> = {
  "horseshoe-bay-squamish": 49.52,
  "squamish-whistler": 49.92,
  "whistler-pemberton": 50.22,
};

/** Point on the real centreline nearest a segment's mid-latitude. */
export function segmentMidpoint(id: SegmentId): [number, number] {
  const targetLat = SEGMENT_LAT[id];
  let best = CORRIDOR_LINE[0]!;
  let bestD = Infinity;
  for (const pt of CORRIDOR_LINE) {
    const d = Math.abs(pt[1] - targetLat);
    if (d < bestD) {
      bestD = d;
      best = pt;
    }
  }
  return best;
}

/**
 * The corridor segment a lat/lon point most likely belongs to. The Sea to Sky
 * corridor is monotonic in latitude, so latitude bands (roughly Squamish at
 * ~49.70 and Whistler at ~50.12) classify a point well enough to prefill a form.
 */
export function segmentForLatLon(lat: number, _lon: number): SegmentId {
  if (lat < 49.7) return "horseshoe-bay-squamish";
  if (lat < 50.12) return "squamish-whistler";
  return "whistler-pemberton";
}

/** Bounding box of the corridor, [[west,south],[east,north]], for fitBounds. */
export function corridorBounds(): [[number, number], [number, number]] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lon, lat] of CORRIDOR_LINE) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [
    [w, s],
    [e, n],
  ];
}
