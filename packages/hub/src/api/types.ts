// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type {
  Confidence,
  ReportKind,
  SegmentId,
  StatusLevel,
  StatusSource,
} from "@nissegroup/shared";

/** Shapes returned by the @nissegroup/core read API. */

/** Minimal GeoJSON point (avoids a hard dependency on @types/geojson). */
export interface GeoPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface StatusSegment {
  segmentId: SegmentId;
  name: string;
  status: StatusLevel;
  source: StatusSource;
  confidence: Confidence;
  updatedAt: string;
  reason: string | null;
}

export interface StatusResponse {
  timestamp: string;
  status: StatusLevel;
  source: StatusSource;
  confidence: Confidence;
  updatedAt: string;
  segments: StatusSegment[];
}

export interface IncidentReport {
  id: string;
  source: string;
  kind: ReportKind | string;
  confidence: Confidence | null;
  summary: string | null;
  isSteward: boolean;
  createdAt: string;
}

export interface Incident {
  id: string;
  segmentId: SegmentId;
  kind: ReportKind | string;
  status: StatusLevel;
  source: StatusSource;
  confidence: Confidence;
  summary: string | null;
  startedAt: string;
  endedAt: string | null;
  active: boolean;
  updatedAt: string;
  geometry: GeoPoint | null;
  reports: IncidentReport[];
  /** COUNT ONLY of linked community requests (the sole community datum shown on status). */
  requestCount: number;
}

export interface IncidentsResponse {
  source: string;
  timestamp: string;
  activeOnly: boolean;
  incidents: Incident[];
}

export interface Webcam {
  id: string;
  segmentId: SegmentId;
  label: string;
  imageUrl: string;
  lastImageUrl: string | null;
  capturedAt: string | null;
  attribution: string | null;
  source: string;
  confidence: Confidence;
}

export interface WebcamsResponse {
  source: string;
  timestamp: string;
  webcams: Webcam[];
}

export interface SnapshotSegment {
  id: SegmentId;
  name: string;
  status: StatusLevel;
  source: StatusSource;
  confidence: Confidence;
  updatedAt: string;
  reason: string | null;
}

export interface SnapshotWebcam {
  id: string;
  segmentId: SegmentId;
  label: string;
  url: string;
  capturedAt: string | null;
}

export interface SnapshotResponse {
  source: string;
  generatedAt: string;
  confidence: Confidence;
  corridor: {
    status: StatusLevel;
    source: StatusSource;
    confidence: Confidence;
    updatedAt: string;
    reason: string | null;
  };
  segments: SnapshotSegment[];
  webcams: SnapshotWebcam[];
  incidents: number;
}

// --- Health + freshness ----------------------------------------------------
export interface WorkerHealthView {
  name: string;
  ok: boolean;
  ageSec: number | null;
  stale: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  runs: number;
  failures: number;
  detail: string | null;
}

export interface HealthReport {
  ok: boolean;
  product: string;
  bootedAt: string;
  now: string;
  workersEnabled: boolean;
  dependencies: {
    database: { ok: boolean; detail: string | null };
    redis: { ok: boolean; detail: string | null };
  };
  open511: {
    lastSuccessfulPollAt: string | null;
    lastEventUpdatedAt: string | null;
    ageSec: number | null;
    staleThresholdSec: number;
    fresh: boolean;
  };
  community: { expirerHealthy: boolean; lastRunAt: string | null };
  workers: WorkerHealthView[];
}

// --- Historical stats ------------------------------------------------------
export interface MonthlyClosures {
  month: string;
  closures: number;
  events: number;
}

export interface SegmentHistory {
  segmentId: SegmentId;
  name: string | null;
  events: number;
  closures: number;
  medianClosureMinutes: number | null;
}

export interface HistoryStatsResponse {
  source: string;
  timestamp: string;
  coverage: { since: string | null; until: string | null; totalEvents: number; totalClosures: number };
  closuresByMonth: MonthlyClosures[];
  worstSegments: SegmentHistory[];
  typicalClosureDuration: {
    medianMinutes: number | null;
    p90Minutes: number | null;
    avgMinutes: number | null;
    sampleSize: number;
  };
}

/** Canned public incident types accepted by POST /api/reports. */
export type IncidentType =
  | "crash"
  | "hazard"
  | "debris"
  | "stopped-traffic"
  | "weather"
  | "wildlife";

export interface SubmitReportRequest {
  incidentType: IncidentType;
  segmentId?: SegmentId;
  lat?: number;
  lon?: number;
  note?: string;
  contact?: string;
  deviceToken?: string;
}

export interface SubmitReportResponse {
  ok: boolean;
  report: { id: string; segmentId: SegmentId; kind: string; trustLevel: string; moderationState: string };
}

// --- Admin / moderation ----------------------------------------------------
export interface QueueReport {
  id: string;
  segmentId: SegmentId;
  segmentName: string;
  incidentType: string | null;
  kind: string;
  source: string;
  trustLevel: string;
  moderationState: string;
  note: string | null;
  summary: string | null;
  severity: string | null;
  contact: string | null;
  confidence: string | null;
  incidentId: string | null;
  createdAt: string;
}

export interface AdminOverride {
  id: string;
  segmentId: SegmentId;
  status: StatusLevel;
  reason: string;
  stewardId: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  createdAt: string;
}

// --- Community plane -------------------------------------------------------
export type RequestKind = "need" | "offer" | "info";
export type RequestCategory = "welfare" | "supplies" | "ride" | "shelter" | "eyes_on" | "other";
export type ContactMethod = "in_app" | "phone" | "none";

export interface RequestResponseItem {
  id: string;
  body: string;
  createdAt: string;
}

export interface CommunityRequestItem {
  id: string;
  kind: RequestKind;
  category: RequestCategory;
  segmentId: SegmentId;
  incidentId: string | null;
  locationDesc: string | null;
  body: string;
  contactMethod: ContactMethod;
  contactValue: string | null;
  status: string;
  createdAt: string;
  expiresAt: string;
  responses: RequestResponseItem[];
}

export interface CreateRequestRequest {
  kind: RequestKind;
  category: RequestCategory;
  segmentId?: SegmentId;
  lat?: number;
  lng?: number;
  locationDesc?: string;
  body: string;
  contactMethod: ContactMethod;
  contactValue?: string;
  deviceToken?: string;
}

// --- Notifications ---------------------------------------------------------
export type NotifChannel = "webpush" | "email" | "telegram" | "sms";
export type SubScope = "corridor" | "segment";
export type SubDirection = "both" | "north" | "south";

export interface NotificationConfig {
  channels: NotifChannel[];
  vapidPublicKey: string | null;
  telegramBot: string | null;
  smsEnabled: boolean;
}

export interface SubscribeRequest {
  channel: NotifChannel;
  scope: SubScope;
  segmentId?: SegmentId;
  direction: SubDirection;
  target: string;
  quietHours?: boolean;
}

export interface SubscribeResponse {
  ok: boolean;
  subscription: { id: string; channel: NotifChannel; verified: boolean; unsubscribeToken: string };
  pendingVerification: boolean;
}
