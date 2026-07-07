// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { Confidence, ReportKind, StatusLevel } from "@nissegroup/shared";

/** Presentation tokens for a corridor/segment status level (cream/pine system). */
export interface StatusStyle {
  label: string;
  /** Soft tinted surface + on-tint text, for the hero banner. */
  surface: string;
  /** Solid chip (status colour fill). */
  chip: string;
  /** Text colour for the emphasised status word. */
  word: string;
  /** Border/accent rule colour. */
  accent: string;
  /** Status dot fill. */
  dot: string;
}

const STATUS_STYLES: Record<StatusLevel, StatusStyle> = {
  OPEN: {
    label: "Open",
    surface: "bg-open-bg",
    chip: "bg-open text-white",
    word: "text-open",
    accent: "border-open",
    dot: "bg-open",
  },
  PARTIAL: {
    label: "Restricted",
    surface: "bg-partial-bg",
    chip: "bg-partial text-white",
    word: "text-partial",
    accent: "border-partial",
    dot: "bg-partial",
  },
  CLOSED: {
    label: "Closed",
    surface: "bg-closed-bg",
    chip: "bg-closed text-white",
    word: "text-closed",
    accent: "border-closed",
    dot: "bg-closed",
  },
};

export function statusStyle(level: StatusLevel): StatusStyle {
  return STATUS_STYLES[level];
}

/** Human labels for report/incident kinds. */
const KIND_LABELS: Record<ReportKind, string> = {
  closure: "Closure",
  "single-lane": "Single lane",
  alternating: "Alternating traffic",
  delay: "Delay",
  clear: "Cleared",
};

export function kindLabel(kind: ReportKind | string): string {
  return (KIND_LABELS as Record<string, string>)[kind] ?? kind;
}

/**
 * Confidence presentation. `unconfirmed` is deliberately the weakest-looking
 * badge — a dashed ochre outline — so it can never be mistaken for an
 * authoritative `official` closure (a solid pine fill).
 */
export interface ConfidenceStyle {
  label: string;
  className: string;
  weight: number;
}

const CONFIDENCE_STYLES: Record<Confidence, ConfidenceStyle> = {
  official: {
    label: "Official",
    className: "bg-pine text-paper border border-pine",
    weight: 3,
  },
  confirmed: {
    label: "Corroborated",
    className: "bg-transparent text-pine border border-pine",
    weight: 2,
  },
  unconfirmed: {
    label: "Reported, unconfirmed",
    className: "bg-partial-bg text-partial border border-dashed border-partial",
    weight: 1,
  },
  assumed: {
    label: "Assumed",
    className: "bg-transparent text-ink-3 border border-dashed border-ink-3",
    weight: 0,
  },
};

export function confidenceStyle(confidence: Confidence | string): ConfidenceStyle {
  return (CONFIDENCE_STYLES as Record<string, ConfidenceStyle>)[confidence] ?? CONFIDENCE_STYLES.assumed;
}

/** Map a status `source` to a short provenance label. */
export function sourceLabel(source: string): string {
  switch (source) {
    case "official":
      return "Official · Open511";
    case "steward":
      return "Steward";
    case "community":
      return "Community";
    case "override":
      return "Steward override";
    default:
      return "System";
  }
}
