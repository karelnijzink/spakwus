// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

/** Official source link, shown alongside every status view. */
export const DRIVEBC_URL = "https://www.drivebc.ca/";

export function DriveBcLink({ className = "" }: { className?: string }) {
  return (
    <a
      href={DRIVEBC_URL}
      target="_blank"
      rel="noreferrer"
      className={`underline decoration-edge underline-offset-2 transition hover:decoration-current ${className}`}
    >
      Check DriveBC
    </a>
  );
}
