// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { Segment, SegmentId } from "./types.js";

/**
 * The three corridor segments of BC Highway 99 that Spakwus tracks, ordered
 * south → north. This is the canonical list; the rest of the system keys off
 * these ids.
 */
export const SEGMENTS: readonly Segment[] = [
  {
    id: "horseshoe-bay-squamish",
    name: "Horseshoe Bay to Squamish",
    from: "Horseshoe Bay",
    to: "Squamish",
    order: 0,
  },
  {
    id: "squamish-whistler",
    name: "Squamish to Whistler",
    from: "Squamish",
    to: "Whistler",
    order: 1,
  },
  {
    id: "whistler-pemberton",
    name: "Whistler to Pemberton",
    from: "Whistler",
    to: "Pemberton",
    order: 2,
  },
] as const;

export const SEGMENT_IDS: readonly SegmentId[] = SEGMENTS.map((s) => s.id);

export function getSegment(id: SegmentId): Segment | undefined {
  return SEGMENTS.find((s) => s.id === id);
}
