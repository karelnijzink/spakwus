// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type {
  Confidence,
  SegmentId,
  StatusLevel,
  StatusSource,
} from "@nissegroup/shared";
import type { DbContext } from "../db/client.js";

const LEVEL_RANK: Record<StatusLevel, number> = { OPEN: 0, PARTIAL: 1, CLOSED: 2 };
const SOURCE_RANK: Record<StatusSource, number> = {
  default: 0,
  community: 1,
  steward: 2,
  official: 3,
  override: 4,
};
const CONFIDENCE_RANK: Record<Confidence, number> = {
  assumed: 0,
  unconfirmed: 1,
  confirmed: 2,
  official: 3,
};

/**
 * Normalize a timestamp to ISO-8601. The raw postgres-js driver returns
 * `timestamptz` values as strings (unlike the Drizzle mapping layer), so read
 * paths coerce defensively and accept either a string or a Date.
 */
function toIso(value: string | Date | null): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface SegmentStatusDto {
  segmentId: SegmentId;
  name: string;
  status: StatusLevel;
  source: StatusSource;
  confidence: Confidence;
  updatedAt: string;
  reason: string | null;
}

export interface CorridorStatusDto {
  status: StatusLevel;
  source: StatusSource;
  confidence: Confidence;
  updatedAt: string;
  segments: SegmentStatusDto[];
}

interface SegmentStatusQueryRow {
  id: SegmentId;
  name: string;
  ord: number;
  status: StatusLevel | null;
  source: StatusSource | null;
  confidence: Confidence | null;
  reason: string | null;
  updated_at: string | Date | null;
}

/** Corridor + per-segment status, assembled from persisted `segment_status`. */
export async function getCorridorStatus(ctx: DbContext): Promise<CorridorStatusDto> {
  const rows = await ctx.sql<SegmentStatusQueryRow[]>`
    SELECT s.id, s.name, s.ord,
           ss.status, ss.source, ss.confidence, ss.reason, ss.updated_at
    FROM segments s
    LEFT JOIN segment_status ss ON ss.segment_id = s.id
    ORDER BY s.ord`;

  const segments: SegmentStatusDto[] = rows.map((r) => ({
    segmentId: r.id,
    name: r.name,
    status: r.status ?? "OPEN",
    source: r.source ?? "default",
    confidence: r.confidence ?? "assumed",
    updatedAt: toIso(r.updated_at) ?? new Date().toISOString(),
    reason: r.reason ?? null,
  }));

  // Roll up to the worst segment; summarise with the strongest source /
  // confidence among the segments at that worst level.
  const worst = segments.reduce(
    (acc, s) => (LEVEL_RANK[s.status] > LEVEL_RANK[acc.status] ? s : acc),
    segments[0] ?? {
      status: "OPEN" as StatusLevel,
      source: "default" as StatusSource,
      confidence: "assumed" as Confidence,
      updatedAt: new Date().toISOString(),
    },
  );
  const atWorst = segments.filter((s) => s.status === worst.status);
  const source = atWorst.reduce<StatusSource>(
    (acc, s) => (SOURCE_RANK[s.source] > SOURCE_RANK[acc] ? s.source : acc),
    (atWorst[0]?.source ?? "default"),
  );
  const confidence = atWorst.reduce<Confidence>(
    (acc, s) => (CONFIDENCE_RANK[s.confidence] > CONFIDENCE_RANK[acc] ? s.confidence : acc),
    (atWorst[0]?.confidence ?? "assumed"),
  );
  const updatedAt = segments.reduce(
    (acc, s) => (s.updatedAt > acc ? s.updatedAt : acc),
    segments[0]?.updatedAt ?? new Date().toISOString(),
  );

  return { status: worst.status, source, confidence, updatedAt, segments };
}

export interface ReportDto {
  id: string;
  source: string;
  kind: string;
  confidence: Confidence | null;
  summary: string | null;
  isSteward: boolean;
  createdAt: string;
}

export interface IncidentDto {
  id: string;
  segmentId: SegmentId;
  kind: string;
  status: StatusLevel;
  source: StatusSource;
  confidence: Confidence;
  summary: string | null;
  startedAt: string;
  endedAt: string | null;
  active: boolean;
  updatedAt: string;
  geometry: unknown | null;
  reports: ReportDto[];
  /**
   * COUNT ONLY of open community requests linked to this incident. This is the
   * one and only thing the status surface may surface from the community plane —
   * never any request content.
   */
  requestCount: number;
}

interface IncidentQueryRow {
  id: string;
  segment_id: SegmentId;
  kind: string;
  status: StatusLevel;
  source: StatusSource;
  confidence: Confidence;
  summary: string | null;
  started_at: string | Date;
  ended_at: string | Date | null;
  active: boolean;
  updated_at: string | Date;
  geometry: unknown | null;
}

interface ReportQueryRow {
  id: string;
  incident_id: string | null;
  source: string;
  kind: string;
  confidence: Confidence | null;
  summary: string | null;
  is_steward: boolean;
  created_at: string | Date;
}

/** Incidents (optionally only active) with their supporting reports nested. */
export async function getIncidents(ctx: DbContext, activeOnly: boolean): Promise<IncidentDto[]> {
  const incidentRows = activeOnly
    ? await ctx.sql<IncidentQueryRow[]>`
        SELECT id, segment_id, kind, status, source, confidence, summary,
               started_at, ended_at, active, updated_at,
               ST_AsGeoJSON(geom)::json AS geometry
        FROM incidents WHERE active = true ORDER BY started_at DESC`
    : await ctx.sql<IncidentQueryRow[]>`
        SELECT id, segment_id, kind, status, source, confidence, summary,
               started_at, ended_at, active, updated_at,
               ST_AsGeoJSON(geom)::json AS geometry
        FROM incidents ORDER BY started_at DESC`;

  if (incidentRows.length === 0) return [];

  const ids = incidentRows.map((i) => i.id);
  const reportRows = await ctx.sql<ReportQueryRow[]>`
    SELECT id, incident_id, source, kind, confidence, summary, is_steward, created_at
    FROM reports WHERE incident_id = ANY(${ids}) ORDER BY created_at ASC`;

  const byIncident = new Map<string, ReportDto[]>();
  for (const r of reportRows) {
    if (!r.incident_id) continue;
    const list = byIncident.get(r.incident_id) ?? [];
    list.push({
      id: r.id,
      source: r.source,
      kind: r.kind,
      confidence: r.confidence,
      summary: r.summary,
      isSteward: r.is_steward,
      createdAt: toIso(r.created_at) ?? "",
    });
    byIncident.set(r.incident_id, list);
  }

  const requestCounts = await getRequestCountsByIncident(ctx, ids);

  return incidentRows.map((i) => ({
    id: i.id,
    segmentId: i.segment_id,
    kind: i.kind,
    status: i.status,
    source: i.source,
    confidence: i.confidence,
    summary: i.summary,
    startedAt: toIso(i.started_at) ?? "",
    endedAt: toIso(i.ended_at),
    active: i.active,
    updatedAt: toIso(i.updated_at) ?? "",
    geometry: i.geometry,
    reports: byIncident.get(i.id) ?? [],
    requestCount: requestCounts.get(i.id) ?? 0,
  }));
}

// --- Admin / moderation reads ---------------------------------------------

export interface PendingReportDto {
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

interface PendingReportRow {
  id: string;
  segment_id: SegmentId;
  segment_name: string;
  incident_type: string | null;
  kind: string;
  source: string;
  trust_level: string;
  moderation_state: string;
  raw_text: string | null;
  summary: string | null;
  severity: string | null;
  contact: string | null;
  confidence: string | null;
  incident_id: string | null;
  created_at: string | Date;
}

/** Reports awaiting moderation (or a given state), newest first. */
export async function getModerationQueue(
  ctx: DbContext,
  state: string,
): Promise<PendingReportDto[]> {
  const rows = await ctx.sql<PendingReportRow[]>`
    SELECT r.id, r.segment_id, s.name AS segment_name, r.incident_type, r.kind, r.source,
           r.trust_level, r.moderation_state, r.raw_text, r.summary, r.severity, r.contact,
           r.confidence, r.incident_id, r.created_at
    FROM reports r JOIN segments s ON s.id = r.segment_id
    WHERE (${state} = 'all' OR r.moderation_state = ${state})
    ORDER BY r.created_at DESC
    LIMIT 200`;
  return rows.map((r) => ({
    id: r.id,
    segmentId: r.segment_id,
    segmentName: r.segment_name,
    incidentType: r.incident_type,
    kind: r.kind,
    source: r.source,
    trustLevel: r.trust_level,
    moderationState: r.moderation_state,
    note: r.raw_text,
    summary: r.summary,
    severity: r.severity,
    contact: r.contact,
    confidence: r.confidence,
    incidentId: r.incident_id,
    createdAt: toIso(r.created_at) ?? "",
  }));
}

export interface OverrideDto {
  id: string;
  segmentId: SegmentId;
  status: StatusLevel;
  reason: string;
  stewardId: string;
  createdAt: string;
  expiresAt: string | null;
}

interface OverrideRow {
  id: string;
  segment_id: SegmentId;
  status: StatusLevel;
  reason: string;
  steward_id: string;
  created_at: string | Date;
  expires_at: string | Date | null;
}

export async function getActiveOverrides(ctx: DbContext): Promise<OverrideDto[]> {
  const rows = await ctx.sql<OverrideRow[]>`
    SELECT id, segment_id, status, reason, steward_id, created_at, expires_at
    FROM steward_overrides WHERE active = true ORDER BY created_at DESC`;
  return rows.map((r) => ({
    id: r.id,
    segmentId: r.segment_id,
    status: r.status,
    reason: r.reason,
    stewardId: r.steward_id,
    createdAt: toIso(r.created_at) ?? "",
    expiresAt: toIso(r.expires_at),
  }));
}

export interface AuditDto {
  id: string;
  actor: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  createdAt: string;
}

interface AuditRow {
  id: string;
  actor: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  created_at: string | Date;
}

export async function getAuditLog(ctx: DbContext, limit = 100): Promise<AuditDto[]> {
  const rows = await ctx.sql<AuditRow[]>`
    SELECT id, actor, action, target_type, target_id, reason, created_at
    FROM audit_log ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    actor: r.actor,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    reason: r.reason,
    createdAt: toIso(r.created_at) ?? "",
  }));
}

// --- Community plane reads (never influence status) ------------------------

export interface RequestResponseDto {
  id: string;
  body: string;
  createdAt: string;
}

export interface CommunityRequestDto {
  id: string;
  kind: string;
  category: string;
  segmentId: SegmentId;
  incidentId: string | null;
  locationDesc: string | null;
  body: string;
  contactMethod: string;
  /** Only exposed when contactMethod is 'phone' (the poster opted into public contact). */
  contactValue: string | null;
  status: string;
  createdAt: string;
  expiresAt: string;
  responses: RequestResponseDto[];
}

export interface RequestFilter {
  incidentId?: string;
  segmentId?: SegmentId;
  bbox?: { west: number; south: number; east: number; north: number };
}

interface CommunityRequestQueryRow {
  id: string;
  kind: string;
  category: string;
  segment_id: SegmentId;
  incident_id: string | null;
  location_desc: string | null;
  body: string;
  contact_method: string;
  contact_value: string | null;
  status: string;
  created_at: string | Date;
  expires_at: string | Date;
}

/** Open, non-expired, non-removed requests for a context, newest first. */
export async function getRequests(ctx: DbContext, filter: RequestFilter): Promise<CommunityRequestDto[]> {
  const incidentId = filter.incidentId ?? null;
  const segmentId = filter.segmentId ?? null;
  const hasBbox = Boolean(filter.bbox);
  const b = filter.bbox ?? { west: 0, south: 0, east: 0, north: 0 };

  const rows = await ctx.sql<CommunityRequestQueryRow[]>`
    SELECT id, kind, category, segment_id, incident_id, location_desc, body, contact_method, contact_value, status, created_at, expires_at
    FROM community_requests cr
    WHERE cr.status = 'open' AND cr.removed_at IS NULL AND cr.expires_at > now()
      AND (${incidentId}::uuid IS NULL OR cr.incident_id = ${incidentId}::uuid)
      AND (${segmentId}::text IS NULL OR cr.segment_id = ${segmentId})
      AND (${!hasBbox} OR (cr.geom IS NOT NULL AND ST_Contains(ST_MakeEnvelope(${b.west}, ${b.south}, ${b.east}, ${b.north}, 4326), cr.geom)))
    ORDER BY cr.created_at DESC
    LIMIT 200`;

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const responseRows = await ctx.sql<{ id: string; request_id: string; body: string; created_at: string | Date }[]>`
    SELECT id, request_id, body, created_at FROM request_responses
    WHERE request_id = ANY(${ids}) AND removed_at IS NULL
    ORDER BY created_at ASC`;
  const byRequest = new Map<string, RequestResponseDto[]>();
  for (const r of responseRows) {
    const list = byRequest.get(r.request_id) ?? [];
    list.push({ id: r.id, body: r.body, createdAt: toIso(r.created_at) ?? "" });
    byRequest.set(r.request_id, list);
  }

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    category: r.category,
    segmentId: r.segment_id,
    incidentId: r.incident_id,
    locationDesc: r.location_desc,
    body: r.body,
    contactMethod: r.contact_method,
    contactValue: r.contact_method === "phone" ? r.contact_value : null,
    status: r.status,
    createdAt: toIso(r.created_at) ?? "",
    expiresAt: toIso(r.expires_at) ?? "",
    responses: byRequest.get(r.id) ?? [],
  }));
}

/** The single count the status surface is allowed to show for an incident. */
export async function getRequestCount(ctx: DbContext, incidentId: string): Promise<number> {
  const rows = await ctx.sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM community_requests
    WHERE incident_id = ${incidentId}::uuid AND status = 'open' AND removed_at IS NULL AND expires_at > now()`;
  return rows[0]?.n ?? 0;
}

/** Counts keyed by incident id, for the incidents list (count only, no content). */
async function getRequestCountsByIncident(ctx: DbContext, incidentIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (incidentIds.length === 0) return map;
  const rows = await ctx.sql<{ incident_id: string; n: number }[]>`
    SELECT incident_id, count(*)::int AS n FROM community_requests
    WHERE incident_id = ANY(${incidentIds}) AND status = 'open' AND removed_at IS NULL AND expires_at > now()
    GROUP BY incident_id`;
  for (const r of rows) map.set(r.incident_id, r.n);
  return map;
}

export interface WebcamDto {
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

interface WebcamQueryRow {
  id: string;
  segment_id: SegmentId;
  label: string;
  image_url: string;
  last_image_url: string | null;
  last_captured_at: string | Date | null;
  attribution: string | null;
}

export async function getWebcams(ctx: DbContext): Promise<WebcamDto[]> {
  const rows = await ctx.sql<WebcamQueryRow[]>`
    SELECT id, segment_id, label, image_url, last_image_url, last_captured_at, attribution
    FROM webcams WHERE active = true ORDER BY segment_id, label`;
  return rows.map((r) => ({
    id: r.id,
    segmentId: r.segment_id,
    label: r.label,
    imageUrl: r.image_url,
    lastImageUrl: r.last_image_url,
    capturedAt: toIso(r.last_captured_at),
    attribution: r.attribution,
    source: "drivebc",
    confidence: "official",
  }));
}
