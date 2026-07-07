// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

/**
 * Core domain types for Spakwus.
 *
 * Timestamps are ISO-8601 strings unless a field name ends in `Ms` (epoch
 * milliseconds). The status state machine (`deriveStatus`) is the only place
 * that interprets these into a corridor/segment status.
 */

/** Stable identifier for one of the three tracked corridor segments. */
export type SegmentId =
  | "horseshoe-bay-squamish"
  | "squamish-whistler"
  | "whistler-pemberton";

/** The three coarse states a segment or the corridor can be in. */
export type StatusLevel = "OPEN" | "PARTIAL" | "CLOSED";

/**
 * The kinds of partial-restriction a PARTIAL status can represent.
 * (single-lane, alternating traffic, and general delay.)
 */
export type PartialKind = "single-lane" | "alternating" | "delay";

/**
 * Where a derived status came from, in increasing authority:
 * - `default`   — no evidence; assumed OPEN.
 * - `community` — derived from public reports.
 * - `steward`   — derived from a trusted steward report.
 * - `official`  — derived from an Open511 official event.
 * - `override`  — a manual steward override (wins over everything).
 */
export type StatusSource =
  | "default"
  | "community"
  | "steward"
  | "official"
  | "override";

/**
 * How confident we are in a status, in increasing strength:
 * - `assumed`     — the OPEN baseline, no supporting evidence.
 * - `unconfirmed` — a single unconfirmed public report backs it.
 * - `confirmed`   — corroborated by ≥2 independent reports or a steward.
 * - `official`    — backed by an Open511 event or a manual override.
 */
export type Confidence = "assumed" | "unconfirmed" | "confirmed" | "official";

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

export interface Segment {
  id: SegmentId;
  /** Human-readable name, e.g. "Horseshoe Bay to Squamish". */
  name: string;
  /** South endpoint label. */
  from: string;
  /** North endpoint label. */
  to: string;
  /** South → north ordering index (0-based). */
  order: number;
}

// ---------------------------------------------------------------------------
// Reports (community + steward observations feeding the state machine)
// ---------------------------------------------------------------------------

/**
 * What a report asserts about a segment.
 * - `closure`     — the segment is fully closed.
 * - partial kinds — a restriction, not a full closure.
 * - `clear`       — the reporter asserts the segment is clear / reopened.
 */
export type ReportKind = "closure" | PartialKind | "clear";

export interface Report {
  id: string;
  segmentId: SegmentId;
  /** What the report asserts. */
  kind: ReportKind;
  /** Opaque, stable id of the reporter — used to judge independence. */
  reporterId: string;
  /**
   * Whether the reporter is a trusted steward. A steward report corroborates
   * on its own; two independent non-steward reports are needed otherwise.
   */
  isSteward: boolean;
  /** When the observation was made (ISO-8601). */
  createdAt: string;
  /** Optional free-text note from the reporter. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Official Open511 events
// ---------------------------------------------------------------------------

/** The subset of Open511 event semantics Spakwus consumes. */
export type OfficialEventKind = "closure" | PartialKind | "cleared";

export interface OfficialEvent {
  id: string;
  segmentId: SegmentId;
  kind: OfficialEventKind;
  /** Event validity start (ISO-8601). */
  startedAt: string;
  /** Event validity end (ISO-8601), or null if open-ended / ongoing. */
  endedAt: string | null;
  /** Last time the source updated this event (ISO-8601). */
  updatedAt: string;
  /** Original Open511 event source id, for traceability. */
  sourceId?: string;
}

// ---------------------------------------------------------------------------
// Steward manual overrides
// ---------------------------------------------------------------------------

export interface StewardOverride {
  id: string;
  segmentId: SegmentId;
  /** Forced status level. */
  status: StatusLevel;
  /** Required human-readable reason; recorded on the resulting status. */
  reason: string;
  /** Steward who set the override. */
  stewardId: string;
  /** When the override was set (ISO-8601). */
  createdAt: string;
  /** Optional expiry (ISO-8601); null/undefined means it stays until removed. */
  expiresAt?: string | null;
}

// ---------------------------------------------------------------------------
// Incidents + derived status
// ---------------------------------------------------------------------------

export interface Incident {
  id: string;
  segmentId: SegmentId;
  /** The status level this incident implies. */
  status: StatusLevel;
  /** For PARTIAL incidents, which kind of restriction. */
  partialKind?: PartialKind;
  source: StatusSource;
  confidence: Confidence;
  /** When the incident began, per its earliest supporting evidence (ISO-8601). */
  startedAt: string;
  /** Ids of the reports that support this incident. */
  reportIds: string[];
  /** Optional summary text. */
  summary?: string;
}

export interface SegmentStatus {
  segmentId: SegmentId;
  status: StatusLevel;
  source: StatusSource;
  confidence: Confidence;
  /** When this status was derived (ISO-8601). */
  updatedAt: string;
  /** Present only for override-sourced statuses. */
  reason?: string;
  /** Incidents currently affecting the segment (may be empty for OPEN). */
  incidents: Incident[];
}

export interface CorridorStatus {
  /** Worst status across all segments. */
  status: StatusLevel;
  source: StatusSource;
  confidence: Confidence;
  updatedAt: string;
  /** Per-segment breakdown, ordered south → north. */
  segments: SegmentStatus[];
}

// ---------------------------------------------------------------------------
// Webcams
// ---------------------------------------------------------------------------

export interface WebcamSource {
  id: string;
  segmentId: SegmentId;
  /** Display label, e.g. "Highway 99 at Tantalus Lookout". */
  label: string;
  /** URL of the still image or stream. */
  imageUrl: string;
  /** Optional attribution / credit line (required by many camera providers). */
  attribution?: string;
  /** How often the underlying source refreshes, in seconds. */
  refreshSeconds?: number;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationChannel = "webpush" | "email" | "telegram" | "sms";

/** Corridor-wide, or a single segment. */
export type SubscriptionScope = "corridor" | "segment";

/** Travel direction of interest (recorded; the status engine is not yet directional). */
export type SubscriptionDirection = "both" | "north" | "south";

export interface NotificationSubscription {
  id: string;
  channel: NotificationChannel;
  scope: SubscriptionScope;
  /** Present when scope is 'segment'. */
  segmentId?: SegmentId | null;
  direction: SubscriptionDirection;
  /**
   * Channel-specific delivery target: a Web Push subscription JSON string, an
   * email address, a Telegram chat id, or a phone number. Kept opaque here.
   */
  target: string;
  /** Email double opt-in state (always true for webpush/telegram/sms). */
  verified: boolean;
  /** Whether quiet hours apply to non-closure alerts for this subscriber. */
  quietHours: boolean;
  createdAt: string;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Community board
//
// IMPORTANT: CommunityRequest / RequestResponse model the community board only.
// They are deliberately NOT inputs to `deriveStatus` — see status.ts. Community
// board activity can never change corridor or segment status.
// ---------------------------------------------------------------------------

/** What the poster is doing: asking for something, offering, or sharing info. */
export type CommunityRequestKind = "need" | "offer" | "info";

/** What the request is about. */
export type CommunityRequestCategory =
  | "welfare"
  | "supplies"
  | "ride"
  | "shelter"
  | "eyes_on"
  | "other";

export type CommunityRequestStatus = "open" | "matched" | "resolved" | "expired";

/** How the poster wants to be reached (defaults to the in-app thread). */
export type ContactMethod = "in_app" | "phone" | "none";

export interface CommunityRequest {
  id: string;
  kind: CommunityRequestKind;
  category: CommunityRequestCategory;
  /** The segment this request is anchored to (context only — never a status input). */
  segmentId: SegmentId;
  /** Active incident this was auto-linked to at creation, if any (context only). */
  incidentId?: string | null;
  lat?: number | null;
  lng?: number | null;
  locationDesc?: string | null;
  /** Short free text. */
  body: string;
  contactMethod: ContactMethod;
  contactValue?: string | null;
  status: CommunityRequestStatus;
  /** Anonymous device token of the poster. */
  createdBy: string;
  createdAt: string;
  expiresAt: string;
}

export interface RequestResponse {
  id: string;
  requestId: string;
  body: string;
  /** Opaque, anonymous reference to the responder. */
  responderRef: string;
  createdAt: string;
}
