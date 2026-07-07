// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { StatusLevel, StatusSource } from "@nissegroup/shared";
import { statusStyle } from "../lib/status.js";
import { timeAgo } from "../lib/time.js";
import type { Incident } from "../api/types.js";
import { DriveBcLink } from "./DriveBcLink.js";
import { Squiggle } from "./Decorations.js";

export interface StatusBannerProps {
  status: StatusLevel;
  updatedAt: string | undefined;
  source?: StatusSource | undefined;
  /** Override reason (shown publicly when the status comes from a steward override). */
  reason?: string | null | undefined;
  primaryIncident?: Incident | undefined;
  primaryLocation?: string | undefined;
}

/** Lead word + trailing status word (emphasised, echoing the Nisse house style). */
const HEADLINE: Record<StatusLevel, { lead: string; word: string }> = {
  OPEN: { lead: "Highway 99 is", word: "open" },
  PARTIAL: { lead: "Highway 99 is", word: "restricted" },
  CLOSED: { lead: "Highway 99 is", word: "closed" },
};

export function StatusBanner({
  status,
  updatedAt,
  source,
  reason,
  primaryIncident,
  primaryLocation,
}: StatusBannerProps) {
  const style = statusStyle(status);
  const head = HEADLINE[status];
  const reopening = primaryIncident?.endedAt ?? null;
  const isOverride = source === "override";

  return (
    <section className={`overflow-hidden rounded-3xl border border-black/5 ${style.surface}`}>
      {/* Colored top hairline for at-a-glance coding. */}
      <div className={`h-1 w-full ${style.chip}`} />

      <div className="px-6 py-7">
        <p className="text-[11px] uppercase tracking-eyebrow text-ink-3">Sea to Sky corridor · Hwy 99</p>

        <h1 className="mt-3 text-4xl font-bold leading-[1.05] tracking-tight text-ink sm:text-5xl">
          {head.lead}{" "}
          <span className="relative inline-block">
            <span className={style.word}>{head.word}</span>
            <Squiggle className={`absolute -bottom-2 left-0 h-2.5 w-full ${style.word}`} />
          </span>
        </h1>

        {isOverride && reason && (
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-2">
            <span className="font-medium text-ink">Steward override:</span> {reason}
          </p>
        )}

        {!isOverride && status !== "OPEN" && (primaryLocation || primaryIncident?.summary) && (
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-2">
            {primaryLocation && <span className="font-medium text-ink">{primaryLocation}. </span>}
            {primaryIncident?.summary}
          </p>
        )}

        {reopening && (
          <p className="mt-1 text-sm text-ink-2">
            Estimated reopening: {new Date(reopening).toLocaleString()}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${style.chip}`}>
            {style.label}
          </span>
          <span className="text-xs text-ink-3">Updated {timeAgo(updatedAt)}</span>
          <DriveBcLink className="text-xs font-medium text-ink-2" />
        </div>
      </div>
    </section>
  );
}
