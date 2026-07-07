// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { Link, useNavigate } from "react-router-dom";

/**
 * The ONLY thing the status surface may show from the community plane: a small
 * tappable count that deep-links into the community board filtered to this
 * incident. Never any request content.
 */
export function RequestCountBadge({
  incidentId,
  count,
  asButton = false,
}: {
  incidentId: string;
  count: number;
  /** Render as a button (for use inside another link, where nested <a> is invalid). */
  asButton?: boolean;
}) {
  const navigate = useNavigate();
  if (count <= 0) return null;

  const to = `/community?incidentId=${encodeURIComponent(incidentId)}`;
  const label = `${count} nearby request${count === 1 ? "" : "s"}`;
  const className =
    "inline-flex items-center gap-1 rounded-full bg-community-bg px-2.5 py-1 text-[11px] font-medium text-community transition hover:bg-community/10";
  const content = (
    <>
      <span aria-hidden>💬</span>
      {label}
    </>
  );

  if (asButton) {
    return (
      <button
        type="button"
        className={className}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          navigate(to);
        }}
      >
        {content}
      </button>
    );
  }
  return (
    <Link to={to} className={className}>
      {content}
    </Link>
  );
}
