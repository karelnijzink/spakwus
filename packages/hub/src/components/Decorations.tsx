// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

/** Hand-drawn underline swash (echoes the Nisse Group house style). */
export function Squiggle({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 300 12"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden
      className={className}
    >
      <path
        d="M2 8C40 3 70 3 108 6c38 3 70 4 108 1 30-2 54-3 80-1"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

/** A thin Sea-to-Sky mountain-range silhouette, used as a section motif. */
export function PeakRule({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 40"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden
      className={className}
    >
      <path
        d="M0 38 L40 22 L70 30 L110 8 L150 30 L190 16 L235 34 L275 12 L320 30 L360 20 L400 34"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

/** Small camera/mountain line mark for webcam placeholders. */
export function CamMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 48" fill="none" aria-hidden className={className}>
      <rect x="6" y="14" width="52" height="30" rx="4" stroke="currentColor" strokeWidth="1.6" opacity="0.6" />
      <path d="M6 40 L24 24 L34 32 L46 20 L58 30" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" opacity="0.6" />
      <circle cx="46" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" opacity="0.6" />
      <path d="M22 14 L26 8 L38 8 L42 14" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" opacity="0.6" />
    </svg>
  );
}
