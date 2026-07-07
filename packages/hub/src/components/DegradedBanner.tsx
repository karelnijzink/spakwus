// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { clockTime, timeAgo } from "../lib/time.js";

/**
 * Shown when the live backend is unreachable but the CDN static fallback (the
 * last-known corridor status) loaded. This is a real, honest state — not live —
 * so it is clearly labelled "service degraded" with the last-confirmed time.
 */
export function DegradedBanner({ confirmedAt }: { confirmedAt: string | undefined }) {
  return (
    <div role="alert" className="border-b border-partial/30 bg-partial-bg px-4 py-2.5 text-partial">
      <div className="mx-auto flex max-w-content items-center gap-2.5">
        <span aria-hidden className="text-base leading-none">
          ⚠
        </span>
        <p className="text-[13px] font-medium">
          Service degraded — showing the last confirmed conditions from{" "}
          {clockTime(confirmedAt)} ({timeAgo(confirmedAt)}). Live updates are
          temporarily unavailable.
        </p>
      </div>
    </div>
  );
}
