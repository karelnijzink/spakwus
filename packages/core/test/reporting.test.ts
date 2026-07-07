// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { SegmentId } from "@nissegroup/shared";
import type { DbContext } from "../src/db/client.js";
import { reports, segmentStatus, stewardOverrides } from "../src/db/schema.js";
import { buildServer } from "../src/api/server.js";
import { dbAvailable, setupTestDb, testConfig, truncateMutable } from "./setup.js";

const describeDb = dbAvailable ? describe : describe.skip;
const SEG: SegmentId = "squamish-whistler";
const AUTH = { authorization: "Bearer test-steward" };

describeDb("public reporting + moderation (integration)", () => {
  let ctx: DbContext;
  let app: FastifyInstance;

  beforeAll(async () => {
    ctx = await setupTestDb();
    // No Redis in tests -> rate limiting fails open, trust classification is anon.
    app = buildServer({ ctx, config: testConfig() });
    await app.ready();
  });
  afterEach(async () => {
    await truncateMutable(ctx);
  });
  afterAll(async () => {
    await app.close();
    await ctx.sql.end();
  });

  async function postReport(body: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/api/reports", payload: body });
  }

  async function statusOf(segmentId: SegmentId) {
    const [row] = await ctx.db.select().from(segmentStatus).where(eq(segmentStatus.segmentId, segmentId));
    return row;
  }

  it("accepts an anon report and stores it as source='web', pending, trust anon", async () => {
    const res = await postReport({ incidentType: "crash", segmentId: SEG, note: "Fender bender blocking a lane" });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.report.trustLevel).toBe("anon");
    expect(body.report.moderationState).toBe("pending");

    const rows = await ctx.db.select().from(reports).where(eq(reports.source, "web"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.moderationState).toBe("pending");
  });

  it("a SINGLE anon report never flips the banner (segment stays OPEN)", async () => {
    // A lane-blocking crash classifies as single-lane (a restriction); a single
    // unconfirmed restriction report still leaves the segment OPEN.
    await postReport({ incidentType: "crash", segmentId: SEG, note: "Crash blocking a lane" });
    const s = await statusOf(SEG);
    expect(s?.status).toBe("OPEN");
    expect(s?.confidence).toBe("unconfirmed");
  });

  it("TWO independent anon reports corroborate to PARTIAL (never CLOSED)", async () => {
    await postReport({ incidentType: "crash", segmentId: SEG, deviceToken: "dev-a", note: "Crash blocking a lane" });
    await postReport({ incidentType: "crash", segmentId: SEG, deviceToken: "dev-b", note: "Crash, one lane blocked" });
    const s = await statusOf(SEG);
    expect(s?.status).toBe("PARTIAL");
    expect(["community"]).toContain(s?.source);
  });

  it("an anon report claiming a full closure is clamped to a partial (cannot close the highway)", async () => {
    await postReport({ incidentType: "crash", segmentId: SEG, deviceToken: "dev-a", note: "Highway fully closed both directions" });
    await postReport({ incidentType: "crash", segmentId: SEG, deviceToken: "dev-b", note: "Road closed, fully blocked" });
    const s = await statusOf(SEG);
    // Corroborated, but clamped to partial family -> PARTIAL, not CLOSED.
    expect(s?.status).toBe("PARTIAL");
  });

  it("rejects a report with no segment and no location", async () => {
    const res = await postReport({ incidentType: "hazard", note: "something" });
    expect(res.statusCode).toBe(400);
  });

  it("resolves a map-pin location to the nearest segment", async () => {
    const res = await postReport({ incidentType: "wildlife", lat: 49.94, lon: -123.12, note: "Bear on the road" });
    expect(res.statusCode).toBe(201);
    expect(res.json().report.segmentId).toBe("squamish-whistler");
  });

  it("verifying an anon report lets it flip the banner (steward vouches)", async () => {
    const post = await postReport({ incidentType: "crash", segmentId: SEG, note: "Serious crash, lane blocked" });
    const reportId = post.json().report.id;
    expect((await statusOf(SEG))?.status).toBe("OPEN"); // single anon -> OPEN

    const verify = await app.inject({ method: "POST", url: `/api/admin/reports/${reportId}/verify`, headers: AUTH });
    expect(verify.statusCode).toBe(200);
    const s = await statusOf(SEG);
    expect(s?.status).toBe("PARTIAL");
    expect(s?.source).toBe("steward");
  });

  it("admin endpoints require the steward bearer token", async () => {
    const noAuth = await app.inject({ method: "GET", url: "/api/admin/reports" });
    expect(noAuth.statusCode).toBe(401);
    const withAuth = await app.inject({ method: "GET", url: "/api/admin/reports", headers: AUTH });
    expect(withAuth.statusCode).toBe(200);
  });

  it("dismiss removes a report from status derivation and audits the action", async () => {
    const post = await postReport({ incidentType: "crash", segmentId: SEG, deviceToken: "d1", note: "crash lane blocked" });
    await postReport({ incidentType: "crash", segmentId: SEG, deviceToken: "d2", note: "crash lane blocked" });
    expect((await statusOf(SEG))?.status).toBe("PARTIAL"); // corroborated

    const dismiss = await app.inject({
      method: "POST",
      url: `/api/admin/reports/${post.json().report.id}/dismiss`,
      headers: AUTH,
      payload: { reason: "duplicate / not real" },
    });
    expect(dismiss.statusCode).toBe(200);
    // Only one active report remains -> back to OPEN (single unconfirmed).
    expect((await statusOf(SEG))?.status).toBe("OPEN");

    const audit = await app.inject({ method: "GET", url: "/api/admin/audit", headers: AUTH });
    expect(audit.json().entries.some((e: { action: string }) => e.action === "report.dismiss")).toBe(true);
  });

  it("a steward override wins, records its reason publicly, and clears", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/admin/overrides",
      headers: AUTH,
      payload: { segmentId: SEG, status: "CLOSED", reason: "Avalanche control 10:00-12:00" },
    });
    expect(create.statusCode).toBe(201);
    const overrideId = create.json().override.id;

    const s = await statusOf(SEG);
    expect(s?.status).toBe("CLOSED");
    expect(s?.source).toBe("override");
    expect(s?.reason).toBe("Avalanche control 10:00-12:00");

    // Reason is exposed publicly on the snapshot.
    const snap = await app.inject({ method: "GET", url: "/api/status/snapshot" });
    const seg = snap.json().segments.find((x: { id: string }) => x.id === SEG);
    expect(seg.reason).toBe("Avalanche control 10:00-12:00");

    const clear = await app.inject({ method: "DELETE", url: `/api/admin/overrides/${overrideId}`, headers: AUTH });
    expect(clear.statusCode).toBe(200);
    expect((await statusOf(SEG))?.status).toBe("OPEN");
    const remaining = await ctx.db.select().from(stewardOverrides).where(eq(stewardOverrides.active, true));
    expect(remaining).toHaveLength(0);
  });
});
