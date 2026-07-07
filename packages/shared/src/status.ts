// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type {
  Confidence,
  CorridorStatus,
  Incident,
  OfficialEvent,
  Report,
  SegmentId,
  SegmentStatus,
  StatusLevel,
  StatusSource,
  StewardOverride,
} from "./types.js";
import { SEGMENTS } from "./segments.js";

/**
 * The corroboration / recency window. Two independent non-steward reports must
 * fall inside a window this wide (relative to `now`) to corroborate a closure,
 * and any report older than this is considered timed-out.
 */
export const CORROBORATION_WINDOW_MS = 45 * 60 * 1000; // 45 minutes

// A segment is PARTIAL ("restricted") only for genuine lane control. A plain
// "delay" (construction / shoulder maintenance advisory) does NOT restrict the
// corridor — the road stays OPEN and the delay is surfaced as an incident, so
// routine maintenance never headlines the highway as restricted.
const PARTIAL_KINDS = new Set<Report["kind"]>(["single-lane", "alternating"]);

/** Rank status levels so the corridor can take the worst across segments. */
const LEVEL_RANK: Record<StatusLevel, number> = {
  OPEN: 0,
  PARTIAL: 1,
  CLOSED: 2,
};

/** Rank sources so the corridor summary can report its most authoritative one. */
const SOURCE_RANK: Record<StatusSource, number> = {
  default: 0,
  community: 1,
  steward: 2,
  official: 3,
  override: 4,
};

/** Rank confidence so the corridor summary can report its strongest. */
const CONFIDENCE_RANK: Record<Confidence, number> = {
  assumed: 0,
  unconfirmed: 1,
  confirmed: 2,
  official: 3,
};

function ms(iso: string): number {
  return Date.parse(iso);
}

function isOfficialEventActive(event: OfficialEvent, nowMs: number): boolean {
  const start = ms(event.startedAt);
  if (Number.isNaN(start) || start > nowMs) return false;
  if (event.endedAt == null) return true;
  const end = ms(event.endedAt);
  if (Number.isNaN(end)) return true;
  return end >= nowMs;
}

function isOverrideActive(override: StewardOverride, nowMs: number): boolean {
  const start = ms(override.createdAt);
  if (Number.isNaN(start) || start > nowMs) return false;
  if (override.expiresAt == null) return true;
  const end = ms(override.expiresAt);
  if (Number.isNaN(end)) return true;
  return end >= nowMs;
}

/** True when `iso` falls within CORROBORATION_WINDOW_MS before `nowMs`. */
function isRecent(iso: string, nowMs: number): boolean {
  const t = ms(iso);
  if (Number.isNaN(t)) return false;
  return t <= nowMs && nowMs - t <= CORROBORATION_WINDOW_MS;
}

function latest<T>(items: T[], time: (t: T) => number): number | null {
  let max: number | null = null;
  for (const item of items) {
    const t = time(item);
    if (Number.isNaN(t)) continue;
    if (max === null || t > max) max = t;
  }
  return max;
}

function makeStatus(
  segmentId: SegmentId,
  status: StatusLevel,
  source: StatusSource,
  confidence: Confidence,
  updatedAt: string,
  incidents: Incident[],
  reason?: string,
): SegmentStatus {
  return { segmentId, status, source, confidence, updatedAt, incidents, ...(reason ? { reason } : {}) };
}

/**
 * Compute the derived status for a single segment.
 *
 * Rule reference (see README / task spec):
 *  1. Default OPEN.
 *  2. CLOSED only on an official closure OR ≥2 independent corroborating reports
 *     in the window; a steward report corroborates alone.
 *  3. A single unconfirmed non-steward report never sets CLOSED — it yields an
 *     `unconfirmed` incident and leaves the segment OPEN.
 *  4. PARTIAL for genuine lane control (single-lane / alternating). A plain
 *     "delay" advisory stays OPEN.
 *  5. Clearing requires official clear, steward clear, or timeout (no active
 *     corroborated incident).
 *  6. A manual steward override always wins and records its reason.
 *  7. Every status carries source, confidence, updatedAt.
 */
function deriveSegmentStatus(
  segmentId: SegmentId,
  reports: Report[],
  officialEvents: OfficialEvent[],
  overrides: StewardOverride[],
  now: Date,
): SegmentStatus {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  // --- Rule 6: manual override always wins. -------------------------------
  const activeOverrides = overrides
    .filter((o) => o.segmentId === segmentId && isOverrideActive(o, nowMs))
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const override = activeOverrides[0];
  if (override) {
    const incident: Incident = {
      id: `override:${override.id}`,
      segmentId,
      status: override.status,
      source: "override",
      confidence: "official",
      startedAt: override.createdAt,
      reportIds: [],
      summary: override.reason,
    };
    return makeStatus(
      segmentId,
      override.status,
      "override",
      "official",
      nowIso,
      override.status === "OPEN" ? [] : [incident],
      override.reason,
    );
  }

  // --- Gather signals within the recency window. --------------------------
  const segReports = reports.filter((r) => r.segmentId === segmentId && isRecent(r.createdAt, nowMs));
  const activeOfficial = officialEvents.filter(
    (e) => e.segmentId === segmentId && isOfficialEventActive(e, nowMs),
  );

  const officialClosure = activeOfficial.find((e) => e.kind === "closure");
  const officialPartials = activeOfficial.filter((e) => PARTIAL_KINDS.has(e.kind as Report["kind"]));
  const officialCleared = activeOfficial.filter((e) => e.kind === "cleared");

  const stewardClosures = segReports.filter((r) => r.isSteward && r.kind === "closure");
  const communityClosures = segReports.filter((r) => !r.isSteward && r.kind === "closure");
  const stewardClears = segReports.filter((r) => r.isSteward && r.kind === "clear");
  const partialReports = segReports.filter((r) => PARTIAL_KINDS.has(r.kind));

  const distinctCommunityCloseReporters = new Set(communityClosures.map((r) => r.reporterId));

  // --- Rule 5: determine the most recent "clear" signal. ------------------
  // Official cleared events and steward clear reports can reopen a segment.
  const clearTime = latest(
    [
      ...stewardClears.map((r) => r.createdAt),
      ...officialCleared.map((e) => e.updatedAt),
    ],
    ms,
  );

  // --- Rule 2: is there a corroborated closure? ---------------------------
  let closure:
    | { source: StatusSource; confidence: Confidence; startedAt: string; reportIds: string[]; time: number }
    | null = null;

  if (officialClosure) {
    closure = {
      source: "official",
      confidence: "official",
      startedAt: officialClosure.startedAt,
      reportIds: [],
      time: ms(officialClosure.updatedAt),
    };
  } else if (stewardClosures.length >= 1) {
    // A steward report corroborates alone.
    const startedAt = stewardClosures.reduce((a, b) => (ms(a.createdAt) < ms(b.createdAt) ? a : b)).createdAt;
    closure = {
      source: "steward",
      confidence: "confirmed",
      startedAt,
      reportIds: stewardClosures.map((r) => r.id),
      time: latest(stewardClosures, (r) => ms(r.createdAt))!,
    };
  } else if (distinctCommunityCloseReporters.size >= 2) {
    // Two or more independent corroborating reports.
    const startedAt = communityClosures.reduce((a, b) => (ms(a.createdAt) < ms(b.createdAt) ? a : b)).createdAt;
    closure = {
      source: "community",
      confidence: "confirmed",
      startedAt,
      reportIds: communityClosures.map((r) => r.id),
      time: latest(communityClosures, (r) => ms(r.createdAt))!,
    };
  }

  // Rule 5: a more-recent clear signal reopens a corroborated closure.
  if (closure && clearTime !== null && clearTime >= closure.time) {
    closure = null;
  }

  if (closure) {
    const incident: Incident = {
      id: `incident:${segmentId}:closure`,
      segmentId,
      status: "CLOSED",
      source: closure.source,
      confidence: closure.confidence,
      startedAt: closure.startedAt,
      reportIds: closure.reportIds,
      summary: "Segment reported closed.",
    };
    return makeStatus(segmentId, "CLOSED", closure.source, closure.confidence, nowIso, [incident]);
  }

  // --- Rule 4: PARTIAL for single-lane / alternating / delay. -------------
  // Official partials outrank community partials; a community partial is
  // unconfirmed unless it is a steward report or independently corroborated.
  let partial:
    | { source: StatusSource; confidence: Confidence; startedAt: string; reportIds: string[]; kind: Report["kind"]; time: number }
    | null = null;

  if (officialPartials.length >= 1) {
    const ev = officialPartials.reduce((a, b) => (ms(a.startedAt) < ms(b.startedAt) ? a : b));
    partial = {
      source: "official",
      confidence: "official",
      startedAt: ev.startedAt,
      reportIds: [],
      kind: ev.kind as Report["kind"],
      time: ms(ev.updatedAt),
    };
  } else if (partialReports.length >= 1) {
    // A PARTIAL takes effect only when corroborated — a steward report alone,
    // or two independent non-steward reports. A single unverified report never
    // flips the banner on its own (it falls through to an unconfirmed incident
    // that leaves the segment OPEN).
    const stewardPartials = partialReports.filter((r) => r.isSteward);
    const distinctReporters = new Set(partialReports.map((r) => r.reporterId));
    const corroborated = stewardPartials.length >= 1 || distinctReporters.size >= 2;
    if (corroborated) {
      const startedAt = partialReports.reduce((a, b) => (ms(a.createdAt) < ms(b.createdAt) ? a : b)).createdAt;
      const newest = partialReports.reduce((a, b) => (ms(a.createdAt) > ms(b.createdAt) ? a : b));
      partial = {
        source: stewardPartials.length >= 1 ? "steward" : "community",
        confidence: "confirmed",
        startedAt,
        reportIds: partialReports.map((r) => r.id),
        kind: newest.kind,
        time: latest(partialReports, (r) => ms(r.createdAt))!,
      };
    }
  }

  // Rule 5: a more-recent clear reopens a partial too.
  if (partial && clearTime !== null && clearTime >= partial.time) {
    partial = null;
  }

  if (partial) {
    const incident: Incident = {
      id: `incident:${segmentId}:partial`,
      segmentId,
      status: "PARTIAL",
      partialKind: partial.kind as Incident["partialKind"],
      source: partial.source,
      confidence: partial.confidence,
      startedAt: partial.startedAt,
      reportIds: partial.reportIds,
      summary: `Segment restricted (${partial.kind}).`,
    };
    return makeStatus(segmentId, "PARTIAL", partial.source, partial.confidence, nowIso, [incident]);
  }

  // --- Rule 3 (generalized): a single unconfirmed non-steward report — of any
  // kind, closure OR partial — never flips the banner. It yields an incident
  // with confidence "unconfirmed" and leaves the segment OPEN. This is what
  // guarantees a lone anonymous web report can never change status.
  const unconfirmedReports = [...communityClosures, ...partialReports].filter(
    (r) => clearTime === null || clearTime < ms(r.createdAt),
  );
  if (unconfirmedReports.length >= 1) {
    const startedAt = unconfirmedReports.reduce((a, b) => (ms(a.createdAt) < ms(b.createdAt) ? a : b)).createdAt;
    const newest = unconfirmedReports.reduce((a, b) => (ms(a.createdAt) > ms(b.createdAt) ? a : b));
    const isClosure = newest.kind === "closure";
    const incident: Incident = {
      id: `incident:${segmentId}:unconfirmed`,
      segmentId,
      status: "OPEN",
      ...(isClosure ? {} : { partialKind: newest.kind as Incident["partialKind"] }),
      source: "community",
      confidence: "unconfirmed",
      startedAt,
      reportIds: unconfirmedReports.map((r) => r.id),
      summary: isClosure
        ? "Unconfirmed closure report; not yet corroborated."
        : `Unconfirmed report (${newest.kind}); not yet corroborated.`,
    };
    return makeStatus(segmentId, "OPEN", "community", "unconfirmed", nowIso, [incident]);
  }

  // --- Rule 1: default OPEN. ----------------------------------------------
  return makeStatus(segmentId, "OPEN", "default", "assumed", nowIso, []);
}

/**
 * Derive corridor + per-segment status from reports, official events and
 * steward overrides at a given instant.
 *
 * PURE and DETERMINISTIC: the output depends only on the inputs (including
 * `now`); it performs no I/O and reads no ambient clock.
 *
 * By design this function does NOT accept community-board data
 * (`CommunityRequest` / `RequestResponse`). Community requests can never change
 * corridor or segment status — the omission is enforced at the type level
 * (rule 8).
 */
export function deriveStatus(
  reports: readonly Report[],
  officialEvents: readonly OfficialEvent[],
  overrides: readonly StewardOverride[],
  now: Date,
): CorridorStatus {
  const reportList = [...reports];
  const eventList = [...officialEvents];
  const overrideList = [...overrides];

  const segments = SEGMENTS.map((segment) =>
    deriveSegmentStatus(segment.id, reportList, eventList, overrideList, now),
  ).sort((a, b) => {
    const oa = SEGMENTS.find((s) => s.id === a.segmentId)!.order;
    const ob = SEGMENTS.find((s) => s.id === b.segmentId)!.order;
    return oa - ob;
  });

  // Corridor = worst level; summarise with the most authoritative source /
  // strongest confidence among the segments that share that worst level.
  const worst = segments.reduce(
    (acc, s) => (LEVEL_RANK[s.status] > LEVEL_RANK[acc.status] ? s : acc),
    segments[0]!,
  );
  const atWorst = segments.filter((s) => s.status === worst.status);
  const source = atWorst.reduce<StatusSource>(
    (acc, s) => (SOURCE_RANK[s.source] > SOURCE_RANK[acc] ? s.source : acc),
    atWorst[0]!.source,
  );
  const confidence = atWorst.reduce<Confidence>(
    (acc, s) => (CONFIDENCE_RANK[s.confidence] > CONFIDENCE_RANK[acc] ? s.confidence : acc),
    atWorst[0]!.confidence,
  );

  return {
    status: worst.status,
    source,
    confidence,
    updatedAt: now.toISOString(),
    segments,
  };
}
