// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

/**
 * The Spakwus mark, inlined as SVG so it's part of the JS bundle — no separate
 * image request that could 404 under a subpath or get served stale by the
 * service worker. Sea to Sky peaks over the highway, in the brand palette.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" role="img" aria-label="Spakwus" className={className}>
      <rect width="512" height="512" rx="96" fill="#2e4a38" />
      <path d="M96 340 L200 190 L268 286 L330 150 L416 340 Z" fill="#f3efe5" opacity="0.96" />
      <rect x="96" y="352" width="320" height="28" rx="14" fill="#f3efe5" />
      <rect x="150" y="360" width="40" height="12" rx="6" fill="#2e4a38" />
      <rect x="236" y="360" width="40" height="12" rx="6" fill="#2e4a38" />
      <rect x="322" y="360" width="40" height="12" rx="6" fill="#2e4a38" />
    </svg>
  );
}
