// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { useEffect, useState } from "react";
import { clockTime, timeAgo } from "../lib/time.js";
import type { SnapshotWebcam } from "../api/types.js";
import { CamMark } from "./Decorations.js";

/**
 * A DriveBC webcam tile showing the live still and its capture time. DriveBC
 * serves current stills at https://www.drivebc.ca/images/<id>.jpg; the backend
 * hands us a cache-busted URL in `cam.url`. Tapping a loaded tile opens a
 * full-size lightbox. If the image fails to load we fall back to a clean
 * on-brand placeholder (and the tile is not interactive).
 */
export function WebcamThumb({ cam }: { cam: SnapshotWebcam }) {
  const [errored, setErrored] = useState(false);
  const [open, setOpen] = useState(false);
  // Clear the error when the image URL changes (e.g. a fresh capture) so a
  // one-off fetch failure doesn't permanently fall back to the placeholder.
  useEffect(() => setErrored(false), [cam.url]);

  // Close the lightbox on Escape and lock body scroll while it's open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const captured = cam.capturedAt ? `${clockTime(cam.capturedAt)} · ${timeAgo(cam.capturedAt)}` : "Awaiting capture";
  const hasImage = Boolean(cam.url) && !errored;

  const media = (
    <div className="relative aspect-video w-full bg-gradient-to-br from-open-bg to-paper-raised">
      {hasImage ? (
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
  );

  return (
    <>
      <figure className="overflow-hidden rounded-2xl border border-edge bg-paper-raised">
        {hasImage ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Enlarge webcam: ${cam.label}`}
            className="block w-full text-left"
          >
            {media}
          </button>
        ) : (
          media
        )}
        <figcaption className="px-3 py-2.5">
          <p className="truncate font-display text-sm text-ink">{cam.label}</p>
          <p className="mt-0.5 text-[11px] text-ink-3">{captured}</p>
        </figcaption>
      </figure>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={cam.label}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="overflow-hidden rounded-2xl border border-black/20">
              <img src={cam.url} alt={cam.label} className="max-h-[75vh] w-full object-contain bg-black" />
            </div>
            <div className="mt-3 flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-lg text-paper">{cam.label}</p>
                <p className="text-xs text-paper/70">Captured {captured} · DriveBC</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full bg-paper/15 px-4 py-1.5 text-sm font-medium text-paper transition hover:bg-paper/25"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
