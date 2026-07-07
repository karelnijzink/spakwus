// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { statusStyle } from "../lib/status.js";
import { timeAgo } from "../lib/time.js";
import type { SnapshotSegment } from "../api/types.js";

/** The three corridor segments, each with its own state and last-updated time. */
export function SegmentStrip({ segments }: { segments: SnapshotSegment[] }) {
  return (
    <section aria-label="Corridor segments" className="grid gap-3 sm:grid-cols-3">
      {segments.map((seg) => {
        const style = statusStyle(seg.status);
        return (
          <div
            key={seg.id}
            className={`rounded-2xl border border-edge border-l-[3px] bg-paper-raised p-4 ${style.accent}`}
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden />
              <span className={`text-[11px] font-semibold uppercase tracking-wide ${style.word}`}>
                {style.label}
              </span>
            </div>
            <p className="mt-2 font-display text-lg leading-tight text-ink">{seg.name}</p>
            <p className="mt-1 text-xs text-ink-3">Updated {timeAgo(seg.updatedAt)}</p>
          </div>
        );
      })}
    </section>
  );
}
