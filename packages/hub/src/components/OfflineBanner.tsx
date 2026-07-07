// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { timeAgo } from "../lib/time.js";

/**
 * Prominent staleness banner shown whenever we render the cached snapshot
 * instead of live data. A stale snapshot is never presented as if it were live.
 */
export function OfflineBanner({ generatedAt }: { generatedAt: string | undefined }) {
  return (
    <div
      role="alert"
      className="border-b border-partial/30 bg-partial-bg px-4 py-2.5 text-partial"
    >
      <div className="mx-auto flex max-w-content items-center gap-2.5">
        <span aria-hidden className="text-base leading-none">
          ⚠
        </span>
        <p className="text-[13px] font-medium">
          Saved conditions — last updated {timeAgo(generatedAt)}. You may be offline;
          this is not live.
        </p>
      </div>
    </div>
  );
}
