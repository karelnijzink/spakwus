// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { Link } from "react-router-dom";
import { DriveBcLink } from "./DriveBcLink.js";

/** An honest note about what Spakwus is (and isn't). Shown on status views. */
export function CoverageNote() {
  return (
    <p className="text-xs leading-relaxed text-ink-3">
      Spakwus shows best-available community and official information for the Sea to
      Sky corridor — it is <span className="font-medium text-ink-2">not an official ruling</span>.
      Conditions can change faster than reports arrive. Always confirm with{" "}
      <DriveBcLink className="text-ink-2" /> and posted signage.{" "}
      <Link to="/about" className="text-ink-2 underline decoration-edge underline-offset-2 hover:decoration-ink-3">
        About this data
      </Link>
      .
    </p>
  );
}
