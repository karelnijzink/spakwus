// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { Confidence } from "@nissegroup/shared";
import { confidenceStyle } from "../lib/status.js";

/**
 * A provenance badge. `unconfirmed` is deliberately styled to look weaker than
 * `official` so a single unverified report never reads as an authoritative
 * closure.
 */
export function ConfidenceBadge({ confidence }: { confidence: Confidence | string }) {
  const style = confidenceStyle(confidence);
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}
