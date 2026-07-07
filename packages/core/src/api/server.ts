// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { brand, type StatusLevel } from "@nissegroup/shared";
import type { DbContext } from "../db/client.js";
import type { Config } from "../config.js";
import type { RedisClient } from "../redis/client.js";
import type { LlmExtractor } from "../services/llm.js";
import type { Senders } from "../services/notifications/channels.js";
import {
  createSubscription,
  unsubscribe,
  verifyEmailSubscription,
} from "../services/notifications/subscriptions.js";
import { notifyRequestResponse } from "../services/notifications/fanout.js";
import { submitReport } from "../services/reports.js";
import {
  clearOverride,
  createOverride,
  dismissReport,
  mergeReports,
  verifyReport,
} from "../services/moderation.js";
import {
  addResponse,
  createRequest,
  escalateRequest,
  flagRequest,
  flagResponse,
  removeRequest,
  removeResponse,
  updateRequestStatus,
} from "../services/community.js";
import { getSteward, requireSteward } from "./auth.js";
import { bustStatusCache, cached } from "../services/cache.js";
import { buildSnapshot } from "../services/snapshot.js";
import { readHealth, type HealthRegistry } from "../services/health.js";
import { getHistoryStats } from "../services/history.js";
import {
  getActiveOverrides,
  getAuditLog,
  getCorridorStatus,
  getIncidents,
  getModerationQueue,
  getRequestCount,
  getRequests,
  getWebcams,
} from "./queries.js";

export interface BuildServerOptions {
  ctx: DbContext;
  config: Config;
  redis?: RedisClient;
  llm?: LlmExtractor;
  senders?: Senders;
  health?: HealthRegistry;
  logger?: boolean | object;
}

const INCIDENT_TYPES = ["crash", "hazard", "debris", "stopped-traffic", "weather", "wildlife"] as const;
const SEGMENT_IDS = ["horseshoe-bay-squamish", "squamish-whistler", "whistler-pemberton"] as const;

const ReportBody = z
  .object({
    incidentType: z.enum(INCIDENT_TYPES),
    segmentId: z.enum(SEGMENT_IDS).optional(),
    lat: z.number().gte(-90).lte(90).optional(),
    lon: z.number().gte(-180).lte(180).optional(),
    note: z.string().max(500).optional(),
    contact: z.string().max(200).optional(),
    deviceToken: z.string().min(1).max(200).optional(),
  })
  .refine((d) => Boolean(d.segmentId) || (typeof d.lat === "number" && typeof d.lon === "number"), {
    message: "A segmentId or a lat/lon location is required.",
  });

const OverrideBody = z.object({
  segmentId: z.enum(SEGMENT_IDS),
  status: z.enum(["OPEN", "PARTIAL", "CLOSED"]),
  reason: z.string().min(3).max(300),
  expiresAt: z.string().datetime().optional(),
});

const MergeBody = z.object({
  reportIds: z.array(z.string().min(1)).min(1).max(50),
  targetIncidentId: z.string().min(1),
});

const REQUEST_KINDS = ["need", "offer", "info"] as const;
const REQUEST_CATEGORIES = ["welfare", "supplies", "ride", "shelter", "eyes_on", "other"] as const;

const CreateRequestBody = z
  .object({
    kind: z.enum(REQUEST_KINDS),
    category: z.enum(REQUEST_CATEGORIES),
    segmentId: z.enum(SEGMENT_IDS).optional(),
    lat: z.number().gte(-90).lte(90).optional(),
    lng: z.number().gte(-180).lte(180).optional(),
    locationDesc: z.string().max(140).optional(),
    body: z.string().min(1).max(400),
    contactMethod: z.enum(["in_app", "phone", "none"]).default("in_app"),
    contactValue: z.string().max(120).optional(),
    ttlHours: z.number().int().min(1).max(48).optional(),
    deviceToken: z.string().min(1).max(200).optional(),
    notifyChannel: z.enum(["webpush", "email", "telegram", "sms"]).optional(),
    notifyTarget: z.string().max(2000).optional(),
  })
  .refine((d) => Boolean(d.segmentId) || (typeof d.lat === "number" && typeof d.lng === "number"), {
    message: "A segmentId or a lat/lng location is required.",
  });

const SubscribeBody = z.object({
  channel: z.enum(["webpush", "email", "telegram", "sms"]),
  scope: z.enum(["corridor", "segment"]).default("corridor"),
  segmentId: z.enum(SEGMENT_IDS).optional(),
  direction: z.enum(["both", "north", "south"]).default("both"),
  target: z.string().min(1).max(4000),
  quietHours: z.boolean().optional(),
});

const ResponseBody = z.object({
  body: z.string().min(1).max(300),
  deviceToken: z.string().min(1).max(200).optional(),
});

const PatchRequestBody = z.object({
  status: z.enum(["matched", "resolved"]),
  deviceToken: z.string().min(1).max(200),
});

const EscalateBody = z.object({
  incidentType: z.enum(INCIDENT_TYPES),
  note: z.string().max(500).optional(),
  deviceToken: z.string().min(1).max(200).optional(),
});

/**
 * Build the read + write API. All read payloads carry provenance — `source`, a
 * timestamp, and (where meaningful) `confidence`. Write endpoints for public
 * reporting are rate-limited; admin endpoints require the steward role.
 */
export function buildServer(options: BuildServerOptions): FastifyInstance {
  const { ctx, config, redis, llm, senders, health } = options;
  const app = Fastify({ logger: options.logger ?? false, trustProxy: true });

  const cacheTtl = config.STATUS_CACHE_TTL_SEC;

  // Liveness — cheap, never touches the DB.
  app.get("/health", async () => ({
    ok: true,
    product: brand.productName,
    publisher: brand.publisher,
    timestamp: new Date().toISOString(),
  }));

  // Public health + freshness report (workers, Open511 freshness, DB/Redis).
  app.get("/api/health", async (_req, reply) => {
    if (!health) return { ok: true, note: "health registry not attached" };
    const report = await readHealth(ctx, redis, health, config);
    // 503 when unhealthy so uptime probes and load balancers can key off status.
    return reply.code(report.ok ? 200 : 503).send(report);
  });

  // --- Public reads --------------------------------------------------------
  app.get("/api/status", async () => {
    const corridor = await cached(redis, "status", cacheTtl, () => getCorridorStatus(ctx));
    return { timestamp: new Date().toISOString(), ...corridor };
  });

  app.get<{ Querystring: { active?: string } }>("/api/incidents", async (req) => {
    const activeOnly = req.query.active === "1" || req.query.active === "true";
    const incidents = await getIncidents(ctx, activeOnly);
    return { source: "spakwus", timestamp: new Date().toISOString(), activeOnly, incidents };
  });

  app.get("/api/webcams", async () => {
    const webcams = await getWebcams(ctx);
    return { source: "drivebc", timestamp: new Date().toISOString(), webcams };
  });

  app.get("/api/status/snapshot", async () => {
    return cached(redis, "snapshot", cacheTtl, () => buildSnapshot(ctx));
  });

  // Historical corridor incident stats, backfilled from DriveBC event CSVs.
  app.get("/api/history/stats", async () => {
    const stats = await getHistoryStats(ctx);
    return { source: "drivebc-historical", timestamp: new Date().toISOString(), ...stats };
  });

  // --- Public write: submit a report --------------------------------------
  app.post("/api/reports", async (req, reply) => {
    const parsed = ReportBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const result = await submitReport(parsed.data, { ctx, redis, config, llm, ip: req.ip });
    if (!result.ok) {
      return reply.code(result.error === "rate_limited" ? 429 : 400).send({ error: result.error, message: result.message });
    }
    await bustStatusCache(redis);
    return reply.code(201).send({ ok: true, timestamp: new Date().toISOString(), report: result.report });
  });

  // --- Admin (steward role) ------------------------------------------------
  const admin = { preHandler: requireSteward(config) };

  app.get<{ Querystring: { state?: string } }>("/api/admin/reports", admin, async (req) => {
    const state = req.query.state ?? "pending";
    const reports = await getModerationQueue(ctx, state);
    return { timestamp: new Date().toISOString(), state, reports };
  });

  app.post<{ Params: { id: string } }>("/api/admin/reports/:id/verify", admin, async (req, reply) => {
    const ok = await verifyReport(ctx, req.params.id, getSteward(req).stewardId);
    if (ok) await bustStatusCache(redis);
    return ok ? { ok: true } : reply.code(404).send({ error: "not_found" });
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/api/admin/reports/:id/dismiss",
    admin,
    async (req, reply) => {
      const ok = await dismissReport(ctx, req.params.id, getSteward(req).stewardId, req.body?.reason);
      if (ok) await bustStatusCache(redis);
      return ok ? { ok: true } : reply.code(404).send({ error: "not_found" });
    },
  );

  app.post("/api/admin/reports/merge", admin, async (req, reply) => {
    const parsed = MergeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const merged = await mergeReports(ctx, parsed.data.reportIds, parsed.data.targetIncidentId, getSteward(req).stewardId);
    await bustStatusCache(redis);
    return { ok: true, merged };
  });

  app.get("/api/admin/overrides", admin, async () => {
    return { timestamp: new Date().toISOString(), overrides: await getActiveOverrides(ctx) };
  });

  app.post("/api/admin/overrides", admin, async (req, reply) => {
    const parsed = OverrideBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const created = await createOverride(
      ctx,
      { ...parsed.data, status: parsed.data.status as StatusLevel },
      getSteward(req).stewardId,
    );
    await bustStatusCache(redis);
    return reply.code(201).send({ ok: true, override: created });
  });

  app.delete<{ Params: { id: string } }>("/api/admin/overrides/:id", admin, async (req, reply) => {
    const ok = await clearOverride(ctx, req.params.id, getSteward(req).stewardId);
    if (ok) await bustStatusCache(redis);
    return ok ? { ok: true } : reply.code(404).send({ error: "not_found" });
  });

  app.get("/api/admin/audit", admin, async () => {
    return { timestamp: new Date().toISOString(), entries: await getAuditLog(ctx, 100) };
  });

  // --- Community plane (separate from status) ------------------------------
  const community = () => ({ ctx, redis, config, ip: "" }) as const;

  app.post("/api/requests", async (req, reply) => {
    const parsed = CreateRequestBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const result = await createRequest(parsed.data, { ...community(), ip: req.ip });
    if (!result.ok) return reply.code(result.error === "rate_limited" ? 429 : 400).send({ error: result.error, message: result.message });
    return reply.code(201).send({ ok: true, request: result.request });
  });

  app.post<{ Params: { id: string } }>("/api/requests/:id/responses", async (req, reply) => {
    const parsed = ResponseBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const responderRef = parsed.data.deviceToken ?? "anon";
    const result = await addResponse(req.params.id, parsed.data.body, responderRef, { ...community(), ip: req.ip });
    if (!result.ok) return reply.code(result.error === "rate_limited" ? 429 : 409).send({ error: result.error });
    // Optional, separate stream: notify the requester of the new reply.
    if (result.notify && senders) {
      void notifyRequestResponse(senders, result.notify.channel, result.notify.target, result.notify.body, config.PUBLIC_BASE_URL);
    }
    return reply.code(201).send({ ok: true });
  });

  app.patch<{ Params: { id: string } }>("/api/requests/:id", async (req, reply) => {
    const parsed = PatchRequestBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await updateRequestStatus(ctx, req.params.id, parsed.data.status, parsed.data.deviceToken);
    if (!result.ok) return reply.code(result.error === "forbidden" ? 403 : 404).send({ error: result.error });
    return { ok: true };
  });

  app.get<{ Querystring: { incidentId?: string; segmentId?: string; bbox?: string } }>(
    "/api/requests",
    async (req) => {
      const { incidentId, segmentId } = req.query;
      let bbox: { west: number; south: number; east: number; north: number } | undefined;
      if (req.query.bbox) {
        const p = req.query.bbox.split(",").map(Number);
        if (p.length === 4 && p.every((n) => Number.isFinite(n))) {
          bbox = { west: p[0]!, south: p[1]!, east: p[2]!, north: p[3]! };
        }
      }
      const requests = await getRequests(ctx, {
        ...(incidentId ? { incidentId } : {}),
        ...(segmentId ? { segmentId: segmentId as never } : {}),
        ...(bbox ? { bbox } : {}),
      });
      return { source: "spakwus-community", timestamp: new Date().toISOString(), requests };
    },
  );

  app.get<{ Params: { id: string } }>("/api/incidents/:id/request-count", async (req) => {
    return { incidentId: req.params.id, count: await getRequestCount(ctx, req.params.id) };
  });

  app.post<{ Params: { id: string } }>("/api/requests/:id/flag", async (req, reply) => {
    const ok = await flagRequest({ ...community(), ip: req.ip }, req.params.id);
    return ok ? { ok: true } : reply.code(404).send({ error: "not_found" });
  });

  app.post<{ Params: { id: string } }>("/api/responses/:id/flag", async (req, reply) => {
    const ok = await flagResponse({ ...community(), ip: req.ip }, req.params.id);
    return ok ? { ok: true } : reply.code(404).send({ error: "not_found" });
  });

  // Optional bridge: escalate a community request into a real status report.
  app.post<{ Params: { id: string } }>("/api/requests/:id/escalate", async (req, reply) => {
    const parsed = EscalateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await escalateRequest(req.params.id, parsed.data.incidentType, parsed.data.note, {
      ...community(),
      ip: req.ip,
      llm,
      deviceToken: parsed.data.deviceToken,
    });
    if (!result.ok) return reply.code(result.error === "rate_limited" ? 429 : 404).send({ error: result.error });
    return reply.code(201).send({ ok: true, reportId: result.reportId });
  });

  // Steward moderation of community content (reuses Phase 3 auth + audit).
  app.post<{ Params: { id: string } }>("/api/admin/requests/:id/remove", admin, async (req, reply) => {
    const ok = await removeRequest(ctx, req.params.id, getSteward(req).stewardId);
    return ok ? { ok: true } : reply.code(404).send({ error: "not_found" });
  });

  app.post<{ Params: { id: string } }>("/api/admin/responses/:id/remove", admin, async (req, reply) => {
    const ok = await removeResponse(ctx, req.params.id, getSteward(req).stewardId);
    return ok ? { ok: true } : reply.code(404).send({ error: "not_found" });
  });

  // --- Notifications -------------------------------------------------------
  app.get("/api/notifications/config", async () => ({
    channels: senders ? [...senders.available] : [],
    vapidPublicKey: config.VAPID_PUBLIC_KEY ?? null,
    telegramBot: config.TELEGRAM_BOT_USERNAME ?? null,
    smsEnabled: config.ENABLE_SMS,
  }));

  app.post("/api/notifications/subscribe", async (req, reply) => {
    if (!senders) return reply.code(503).send({ error: "notifications_unconfigured" });
    const parsed = SubscribeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const result = await createSubscription(parsed.data, { ctx, config, senders });
    if (!result.ok) return reply.code(409).send({ error: result.error });
    return reply.code(201).send(result);
  });

  app.post<{ Body: { token?: string } }>("/api/notifications/unsubscribe", async (req, reply) => {
    const token = req.body?.token;
    if (!token) return reply.code(400).send({ error: "invalid_request" });
    const ok = await unsubscribe(ctx, token);
    return ok ? { ok: true } : reply.code(404).send({ error: "not_found" });
  });

  app.get<{ Querystring: { token?: string } }>("/api/notifications/verify", async (req, reply) => {
    const token = req.query.token;
    if (!token || !(await verifyEmailSubscription(ctx, token))) {
      return reply.code(400).type("text/html").send("<h1>Link expired or invalid.</h1>");
    }
    return reply.redirect(`${config.PUBLIC_BASE_URL}/alerts?verified=1`);
  });

  // Telegram bot webhook: a "/start" DM subscribes the chat to corridor alerts.
  app.post("/api/notifications/telegram/webhook", async (req, reply) => {
    if (!senders?.available.has("telegram")) return reply.code(200).send({ ok: true });
    const update = req.body as { message?: { chat?: { id?: number }; text?: string } };
    const chatId = update.message?.chat?.id;
    const text = update.message?.text ?? "";
    if (chatId && text.startsWith("/start")) {
      const result = await createSubscription(
        { channel: "telegram", scope: "corridor", direction: "both", target: String(chatId) },
        { ctx, config, senders },
      );
      if (result.ok) {
        await senders.byChannel.telegram
          ?.send(String(chatId), {
            title: "Spakwus alerts on",
            body: "You'll get Sea to Sky (Hwy 99) status alerts here. Reply /stop to unsubscribe.",
            url: config.PUBLIC_BASE_URL,
          })
          .catch(() => {});
      }
    }
    return { ok: true };
  });

  return app;
}
