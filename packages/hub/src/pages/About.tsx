// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { Link } from "react-router-dom";
import { brand } from "@nissegroup/shared";
import { DriveBcLink } from "../components/DriveBcLink.js";
import { PeakRule } from "../components/Decorations.js";
import { HAS_BACKEND, HAS_COMMUNITY } from "../lib/features.js";

function Heading({ children }: { children: string }) {
  return <h2 className="font-display text-xl text-ink">{children}</h2>;
}

export function About() {
  return (
    <div className="mx-auto max-w-content space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-eyebrow text-ink-3">About</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">{brand.productName}</h1>
        <PeakRule className="mt-3 h-5 w-44 text-pine" />
      </div>

      <p className="text-[15px] leading-relaxed text-ink-2">
        {brand.productName} is a live conditions hub{HAS_COMMUNITY ? " and community board" : ""} for the Sea to
        Sky Highway (BC Highway 99) between Horseshoe Bay and Pemberton. It is a product
        of{" "}
        <a
          href={brand.publisherUrl}
          target="_blank"
          rel="noreferrer"
          className="font-display text-ink underline decoration-edge underline-offset-2"
        >
          {brand.publisher}
        </a>
        .
      </p>

      <div className="space-y-2">
        <Heading>The name</Heading>
        <p className="text-sm leading-relaxed text-ink-2">
          Spakwus is the Sḵwx̱wú7mesh (Squamish) word for eagle — a watcher from above, which
          is exactly what this is: an eye on the corridor, looking out for the people
          traveling it. It's a local name — Brackendale's gathering eagles are world-famous,
          and the eagle is a being the Squamish Nation uses to represent itself.
        </p>
      </div>

      <div className="rounded-2xl border border-closed/20 bg-closed-bg/60 p-5">
        <p className="font-display text-lg text-closed">This is not an official ruling.</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
          {brand.productName} shows <strong className="font-semibold text-ink">best-available
          community and official information</strong>. It may be incomplete, delayed, or
          wrong. It does not decide whether the highway is open or closed and must never be
          relied on for safety-critical decisions. For the official status, always check{" "}
          <DriveBcLink className="font-medium text-ink-2" /> and obey posted signage and
          traffic control.
        </p>
      </div>

      <div className="space-y-2">
        <Heading>How status is decided</Heading>
        <p className="text-sm leading-relaxed text-ink-2">
          Status is computed live from DriveBC's official Open511 feed. Construction and
          maintenance advisories are shown but don't restrict the highway — only real lane
          control or a closure does. Conditions are also saved to your device, so it still
          opens after you lose signal, always marked with when they were last updated.
        </p>
      </div>

      {HAS_BACKEND && (
        <div className="space-y-2">
          <Heading>Explore more</Heading>
          <p className="text-sm leading-relaxed text-ink-2">
            See the{" "}
            <Link to="/history" className="font-medium text-pine underline decoration-edge underline-offset-2">
              corridor incident history
            </Link>{" "}
            (closures per month, worst segments, typical durations), or check{" "}
            <Link to="/health" className="font-medium text-pine underline decoration-edge underline-offset-2">
              system status
            </Link>{" "}
            for backend health and data freshness.
          </p>
        </div>
      )}

      <p className="text-xs text-ink-3">
        Webcam imagery courtesy of DriveBC. Map data © OpenStreetMap contributors.
      </p>

      <p className="border-t border-edge pt-5 text-center text-xs text-ink-3">
        Contact{" "}
        <a href={`mailto:${brand.supportEmail}`} className="underline decoration-edge underline-offset-2">
          {brand.supportEmail}
        </a>
      </p>
    </div>
  );
}
