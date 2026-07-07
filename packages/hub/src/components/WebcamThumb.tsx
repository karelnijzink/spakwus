// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { useEffect, useState } from "react";
import { clockTime, timeAgo } from "../lib/time.js";
import type { SnapshotWebcam } from "../api/types.js";
import { CamMark } from "./Decorations.js";

/**
 * A DriveBC webcam tile showing the live still and its capture time. DriveBC
 * serves current stills at https://www.drivebc.ca/images/<id>.jpg; the backend
 * hands us a cache-busted URL in `cam.url`. If the image fails to load we fall
 * back to a clean on-brand placeholder rather than a broken image.
 */
export function WebcamThumb({ cam }: { cam: SnapshotWebcam }) {
  const [errored, setErrored] = useState(false);
  // Clear the error when the image URL changes (e.g. a fresh capture) so a
  // one-off fetch failure doesn't permanently fall back to the placeholder.
  useEffect(() => setErrored(false), [cam.url]);
  return (
    <figure className="overflow-hidden rounded-2xl border border-edge bg-paper-raised">
      <div className="relative aspect-video w-full bg-gradient-to-br from-open-bg to-paper-raised">
        {cam.url && !errored ? (
          <img
            src={cam.url}
            alt={cam.label}
            loading="lazy"
            onError={() => setErrored(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <CamMark className="h-10 w-12 text-pine" />
          </div>
        )}
        <span className="absolute right-2 top-2 rounded-full bg-paper/80 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-3 backdrop-blur">
          DriveBC
        </span>
      </div>
      <figcaption className="px-3 py-2.5">
        <p className="truncate font-display text-sm text-ink">{cam.label}</p>
        <p className="mt-0.5 text-[11px] text-ink-3">
          {cam.capturedAt ? (
            <>
              {clockTime(cam.capturedAt)} · {timeAgo(cam.capturedAt)}
            </>
          ) : (
            "Awaiting capture"
          )}
        </p>
      </figcaption>
    </figure>
  );
}
