// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { getSegment, type SegmentId, type StatusLevel } from "@nissegroup/shared";

export interface AlertMessage {
  title: string;
  body: string;
  url: string;
}

export interface AlertInput {
  segmentId: SegmentId;
  toState: StatusLevel;
  fromState: StatusLevel | null;
  /** "official" | "corroborated" | "steward" — how the flip was determined. */
  sourceLabel: string;
  summary?: string | null;
  reason?: string | null;
  at: Date;
  baseUrl: string;
}

function pacificTime(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Vancouver",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

/**
 * Actionable, located, timestamped alert copy. This is deliberately the same
 * whatever the channel; channels wrap it.
 */
export function buildAlertMessage(input: AlertInput): AlertMessage {
  const segment = getSegment(input.segmentId);
  const name = segment?.name ?? input.segmentId;
  const fromTown = segment?.from ?? "town";
  const time = pacificTime(input.at);
  const url = `${input.baseUrl}/`;
  const detail = input.reason ?? input.summary ?? null;
  const source = input.sourceLabel;

  if (input.toState === "CLOSED") {
    return {
      title: `Highway 99 CLOSED — ${name}`,
      body:
        `Highway 99 CLOSED — ${name}, both directions, as of ${time}.` +
        (detail ? ` ${detail}.` : "") +
        ` If you have not left ${fromTown} yet, wait. Source: ${source}. Details: ${url}`,
      url,
    };
  }

  if (input.toState === "PARTIAL") {
    return {
      title: `Highway 99 restricted — ${name}`,
      body:
        `Highway 99 partly restricted — ${name}, as of ${time}.` +
        (detail ? ` ${detail}.` : "") +
        ` Expect delays; consider waiting in ${fromTown}. Source: ${source}. Details: ${url}`,
      url,
    };
  }

  // Cleared (OPEN, from a prior restriction/closure).
  return {
    title: `Highway 99 reopened — ${name}`,
    body: `Highway 99 has reopened — ${name}, as of ${time}. Drive to conditions. Details: ${url}`,
    url,
  };
}

/** Which status flips generate an alert (rule: PARTIAL/CLOSED, or a clear). */
export function shouldNotify(fromState: string | null, toState: string): boolean {
  if (toState === "CLOSED" || toState === "PARTIAL") return true;
  if (toState === "OPEN" && (fromState === "CLOSED" || fromState === "PARTIAL")) return true;
  return false;
}
