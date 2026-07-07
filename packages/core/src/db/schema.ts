// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import {
  boolean,
  customType,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CommunityRequestCategory,
  CommunityRequestKind,
  CommunityRequestStatus,
  Confidence,
  ContactMethod,
  NotificationChannel,
  ReportKind,
  SegmentId,
  StatusLevel,
  StatusSource,
  SubscriptionDirection,
  SubscriptionScope,
} from "@nissegroup/shared";

/**
 * PostGIS geometry columns. Values are read/written as GeoJSON/WKT via explicit
 * SQL (ST_AsGeoJSON / ST_GeomFromGeoJSON) rather than through Drizzle's
 * parameter binding, so the TS-side representation is just an opaque string.
 */
const lineString = customType<{ data: string; driverData: string }>({
  dataType: () => "geometry(LineString,4326)",
});
const point = customType<{ data: string; driverData: string }>({
  dataType: () => "geometry(Point,4326)",
});

export type ReportSource = "open511" | "community" | "steward" | "web";
export type TrustLevel = "anon" | "known" | "steward";
export type ModerationState = "pending" | "verified" | "dismissed" | "merged";
/** Canned public incident types (distinct from the deriveStatus `kind`). */
export type IncidentType =
  | "crash"
  | "hazard"
  | "debris"
  | "stopped-traffic"
  | "weather"
  | "wildlife";

// --- segments (seeded; the three corridor segments) ------------------------
export const segments = pgTable("segments", {
  id: text("id").$type<SegmentId>().primaryKey(),
  name: text("name").notNull(),
  fromLabel: text("from_label").notNull(),
  toLabel: text("to_label").notNull(),
  ord: integer("ord").notNull(),
  geom: lineString("geom").notNull(),
});

// --- incidents (operational grouping of reports) ---------------------------
export const incidents = pgTable("incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  segmentId: text("segment_id").$type<SegmentId>().notNull(),
  kind: text("kind").$type<ReportKind>().notNull(),
  status: text("status").$type<StatusLevel>().notNull(),
  source: text("source").$type<StatusSource>().notNull(),
  confidence: text("confidence").$type<Confidence>().notNull(),
  summary: text("summary"),
  geom: point("geom"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- reports (community, steward, and normalized Open511 observations) ------
export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  segmentId: text("segment_id").$type<SegmentId>().notNull(),
  incidentId: uuid("incident_id"),
  source: text("source").$type<ReportSource>().notNull(),
  kind: text("kind").$type<ReportKind>().notNull(),
  reporterId: text("reporter_id").notNull(),
  isSteward: boolean("is_steward").notNull().default(false),
  /** Open511 event id (or other upstream id) for idempotent upserts. */
  externalId: text("external_id"),
  rawText: text("raw_text"),
  /** LLM-derived one-line summary (see services/llm.ts). */
  summary: text("summary"),
  confidence: text("confidence").$type<Confidence>(),
  /** Canned public incident type (crash/hazard/...), when submitted via /api/reports. */
  incidentType: text("incident_type").$type<IncidentType>(),
  /** Reporter trust: anon (default), known (returning device), or steward. */
  trustLevel: text("trust_level").$type<TrustLevel>().notNull().default("anon"),
  /** Optional reporter contact (email/phone), never shown publicly. */
  contact: text("contact"),
  /** Opaque per-device token used for trust + rate limiting. */
  deviceToken: text("device_token"),
  /** LLM-derived severity hint. */
  severity: text("severity"),
  /** Moderation lifecycle for web reports. */
  moderationState: text("moderation_state").$type<ModerationState>().notNull().default("pending"),
  geom: point("geom"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- segment_status (latest derived status per segment) --------------------
export const segmentStatus = pgTable("segment_status", {
  segmentId: text("segment_id").$type<SegmentId>().primaryKey(),
  status: text("status").$type<StatusLevel>().notNull(),
  source: text("source").$type<StatusSource>().notNull(),
  confidence: text("confidence").$type<Confidence>().notNull(),
  reason: text("reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- webcams ---------------------------------------------------------------
export const webcams = pgTable("webcams", {
  id: text("id").primaryKey(),
  segmentId: text("segment_id").$type<SegmentId>().notNull(),
  label: text("label").notNull(),
  imageUrl: text("image_url").notNull(),
  sourceUrl: text("source_url"),
  attribution: text("attribution"),
  refreshSeconds: integer("refresh_seconds").notNull().default(120),
  lastCapturedAt: timestamp("last_captured_at", { withTimezone: true }),
  lastImageUrl: text("last_image_url"),
  active: boolean("active").notNull().default(true),
});

// --- status_changes (append-only audit trail) ------------------------------
export const statusChanges = pgTable("status_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  segmentId: text("segment_id").$type<SegmentId>().notNull(),
  fromState: text("from_state").$type<StatusLevel>(),
  toState: text("to_state").$type<StatusLevel>().notNull(),
  cause: text("cause").notNull(),
  actor: text("actor").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Fan-out cursor: set once the notifier has processed this flip. */
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
});

// --- steward_overrides (manual status overrides, deriveStatus rule 6) ------
export const stewardOverrides = pgTable("steward_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  segmentId: text("segment_id").$type<SegmentId>().notNull(),
  status: text("status").$type<StatusLevel>().notNull(),
  reason: text("reason").notNull(),
  stewardId: text("steward_id").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
});

// --- audit_log (append-only admin/moderation trail) ------------------------
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- community_requests (COMMUNITY plane — never read by deriveStatus) ------
export const communityRequests = pgTable("community_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").$type<CommunityRequestKind>().notNull(),
  category: text("category").$type<CommunityRequestCategory>().notNull(),
  segmentId: text("segment_id").$type<SegmentId>().notNull(),
  incidentId: uuid("incident_id"),
  geom: point("geom"),
  locationDesc: text("location_desc"),
  body: text("body").notNull(),
  contactMethod: text("contact_method").$type<ContactMethod>().notNull().default("in_app"),
  contactValue: text("contact_value"),
  status: text("status").$type<CommunityRequestStatus>().notNull().default("open"),
  createdBy: text("created_by").notNull(),
  /** Optional: notify the requester when someone responds (separate from status alerts). */
  notifyChannel: text("notify_channel").$type<NotificationChannel>(),
  notifyTarget: text("notify_target"),
  flagCount: integer("flag_count").notNull().default(0),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removedBy: text("removed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const requestResponses = pgTable("request_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  body: text("body").notNull(),
  responderRef: text("responder_ref").notNull(),
  flagCount: integer("flag_count").notNull().default(0),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removedBy: text("removed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- notification_subscriptions --------------------------------------------
export const notificationSubscriptions = pgTable("notification_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: text("channel").$type<NotificationChannel>().notNull(),
  scope: text("scope").$type<SubscriptionScope>().notNull().default("corridor"),
  segmentId: text("segment_id").$type<SegmentId>(),
  direction: text("direction").$type<SubscriptionDirection>().notNull().default("both"),
  target: text("target").notNull(),
  targetKey: text("target_key").notNull(),
  verified: boolean("verified").notNull().default(false),
  verifyToken: text("verify_token"),
  unsubscribeToken: text("unsubscribe_token").notNull(),
  quietHours: boolean("quiet_hours").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- notification_deliveries (per-subscriber per-flip dedup) ----------------
export const notificationDeliveries = pgTable("notification_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriptionId: uuid("subscription_id").notNull(),
  statusChangeId: uuid("status_change_id").notNull(),
  channel: text("channel").$type<NotificationChannel>().notNull(),
  sent: boolean("sent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- historical_events (retrospective analytics only; never read by status) -
export const historicalEvents = pgTable("historical_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type"),
  severity: text("severity"),
  isClosure: boolean("is_closure").notNull().default(false),
  roadName: text("road_name"),
  direction: text("direction"),
  segmentId: text("segment_id").$type<SegmentId>(),
  description: text("description"),
  geom: point("geom"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  durationMinutes: integer("duration_minutes"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HistoricalEventRow = typeof historicalEvents.$inferSelect;
export type SegmentRow = typeof segments.$inferSelect;
export type StewardOverrideRow = typeof stewardOverrides.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type CommunityRequestRow = typeof communityRequests.$inferSelect;
export type RequestResponseRow = typeof requestResponses.$inferSelect;
export type NotificationSubscriptionRow = typeof notificationSubscriptions.$inferSelect;
export type NotificationDeliveryRow = typeof notificationDeliveries.$inferSelect;
export type IncidentRow = typeof incidents.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;
export type SegmentStatusRow = typeof segmentStatus.$inferSelect;
export type WebcamRow = typeof webcams.$inferSelect;
export type StatusChangeRow = typeof statusChanges.$inferSelect;
