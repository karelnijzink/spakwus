// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { SegmentId } from "@nissegroup/shared";
import type { DbContext } from "../src/db/client.js";
import { communityRequests, reports, segmentStatus } from "../src/db/schema.js";
import { buildServer } from "../src/api/server.js";
import { matchOrCreateIncident, reconcile } from "../src/services/reconciler.js";
import { expireRequests } from "../src/services/community.js";
import { dbAvailable, setupTestDb, testConfig, truncateMutable } from "./setup.js";

const describeDb = dbAvailable ? describe : describe.skip;
const SEG: SegmentId = "squamish-whistler";
const AUTH = { authorization: "Bearer test-steward" };

describeDb("community requests (integration)", () => {
  let ctx: DbContext;
  let app: FastifyInstance;

  beforeAll(async () => {
    ctx = await setupTestDb();
    app = buildServer({ ctx, config: testConfig() });
    await app.ready();
  });
  afterEach(async () => {
    await ctx.sql`TRUNCATE request_responses, community_requests RESTART IDENTITY CASCADE`;
    await truncateMutable(ctx);
  });
  afterAll(async () => {
    await app.close();
    await ctx.sql.end();
  });

  async function createIncidentOnSeg() {
    const [row] = await ctx.db
      .insert(reports)
      .values({ segmentId: SEG, source: "steward", kind: "closure", reporterId: "s1", isSteward: true })
      .returning();
    const inc = await matchOrCreateIncident(ctx, row!, new Date());
    await reconcile(ctx, { cause: "test", actor: "test" });
    return inc!;
  }

  async function postRequest(body: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/api/requests", payload: body });
  }

  it("creates a request and auto-links it to the active incident on the segment", async () => {
    const incidentId = await createIncidentOnSeg();
    const res = await postRequest({
      kind: "need",
      category: "welfare",
      segmentId: SEG,
      body: "Elderly passenger, needs water and a washroom.",
      deviceToken: "dev-a",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().request.incidentId).toBe(incidentId);
  });

  it("a community request NEVER changes segment status", async () => {
    await reconcile(ctx, { cause: "baseline", actor: "test" });
    const before = (await ctx.db.select().from(segmentStatus).where(eq(segmentStatus.segmentId, SEG)))[0];
    await postRequest({ kind: "need", category: "supplies", segmentId: SEG, body: "Anyone have a jerry can?", deviceToken: "d" });
    const after = (await ctx.db.select().from(segmentStatus).where(eq(segmentStatus.segmentId, SEG)))[0];
    expect(after?.status).toBe(before?.status);
    expect(after?.status).toBe("OPEN");
  });

  it("request-count endpoint and incidents-list count reflect open requests (count only)", async () => {
    const incidentId = await createIncidentOnSeg();
    await postRequest({ kind: "need", category: "ride", incidentId, segmentId: SEG, body: "Ride to Squamish?", deviceToken: "d1" });
    await postRequest({ kind: "offer", category: "shelter", segmentId: SEG, body: "Spare room in Squamish", deviceToken: "d2" });

    const count = await app.inject({ method: "GET", url: `/api/incidents/${incidentId}/request-count` });
    expect(count.json().count).toBe(2);

    const incidents = await app.inject({ method: "GET", url: "/api/incidents?active=1" });
    const inc = incidents.json().incidents.find((i: { id: string }) => i.id === incidentId);
    expect(inc.requestCount).toBe(2);
    // The status payload carries only the count, never request bodies.
    expect(JSON.stringify(inc)).not.toContain("Ride to Squamish");
  });

  it("lists open requests for a context with their response threads", async () => {
    const post = await postRequest({ kind: "info", category: "eyes_on", segmentId: SEG, body: "Rockslide still blocking?", deviceToken: "d1" });
    const id = post.json().request.id;
    const resp = await app.inject({ method: "POST", url: `/api/requests/${id}/responses`, payload: { body: "Eyes on it — one lane open now.", deviceToken: "d2" } });
    expect(resp.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: `/api/requests?segmentId=${SEG}` });
    const reqs = list.json().requests;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].responses).toHaveLength(1);
    expect(reqs[0].responses[0].body).toContain("Eyes on it");
  });

  it("only the requester can mark matched/resolved", async () => {
    const post = await postRequest({ kind: "need", category: "ride", segmentId: SEG, body: "Ride north?", deviceToken: "owner" });
    const id = post.json().request.id;
    const wrong = await app.inject({ method: "PATCH", url: `/api/requests/${id}`, payload: { status: "matched", deviceToken: "someone-else" } });
    expect(wrong.statusCode).toBe(403);
    const ok = await app.inject({ method: "PATCH", url: `/api/requests/${id}`, payload: { status: "resolved", deviceToken: "owner" } });
    expect(ok.statusCode).toBe(200);
    // Resolved requests drop off the open board.
    const list = await app.inject({ method: "GET", url: `/api/requests?segmentId=${SEG}` });
    expect(list.json().requests).toHaveLength(0);
  });

  it("phone contact is exposed publicly; in_app contact value is not", async () => {
    await postRequest({ kind: "offer", category: "ride", segmentId: SEG, body: "Room for 2", contactMethod: "phone", contactValue: "604-555-0100", deviceToken: "d1" });
    await postRequest({ kind: "need", category: "welfare", segmentId: SEG, body: "Check on my mom", contactMethod: "in_app", contactValue: "secret@example.com", deviceToken: "d2" });
    const list = (await app.inject({ method: "GET", url: `/api/requests?segmentId=${SEG}` })).json().requests;
    const phone = list.find((r: { body: string }) => r.body === "Room for 2");
    const inApp = list.find((r: { body: string }) => r.body === "Check on my mom");
    expect(phone.contactValue).toBe("604-555-0100");
    expect(inApp.contactValue).toBeNull();
  });

  it("stewards can remove a request", async () => {
    const post = await postRequest({ kind: "need", category: "other", segmentId: SEG, body: "spam spam spam", deviceToken: "d1" });
    const id = post.json().request.id;
    const remove = await app.inject({ method: "POST", url: `/api/admin/requests/${id}/remove`, headers: AUTH });
    expect(remove.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: `/api/requests?segmentId=${SEG}` });
    expect(list.json().requests).toHaveLength(0);
  });

  it("expires requests past their TTL and when the linked incident clears", async () => {
    // Past TTL.
    const [stale] = await ctx.db
      .insert(communityRequests)
      .values({ kind: "need", category: "supplies", segmentId: SEG, body: "old post", contactMethod: "in_app", createdBy: "d", expiresAt: new Date(Date.now() - 60_000) })
      .returning();
    // Linked to an incident that is not active.
    const incidentId = await createIncidentOnSeg();
    await ctx.db.update(reports).set({ active: false }).where(eq(reports.source, "steward"));
    await ctx.sql`UPDATE incidents SET active = false WHERE id = ${incidentId}::uuid`;
    const [linked] = await ctx.db
      .insert(communityRequests)
      .values({ kind: "info", category: "eyes_on", segmentId: SEG, incidentId, body: "linked", contactMethod: "in_app", createdBy: "d", expiresAt: new Date(Date.now() + 3_600_000) })
      .returning();

    const n = await expireRequests(ctx);
    expect(n).toBe(2);
    const s1 = (await ctx.db.select().from(communityRequests).where(eq(communityRequests.id, stale!.id)))[0];
    const l1 = (await ctx.db.select().from(communityRequests).where(eq(communityRequests.id, linked!.id)))[0];
    expect(s1?.status).toBe("expired");
    expect(l1?.status).toBe("expired");
  });

  it("bridge: escalating a request creates a real status report", async () => {
    const post = await postRequest({ kind: "info", category: "eyes_on", segmentId: SEG, body: "Tree down across both lanes", deviceToken: "d1" });
    const id = post.json().request.id;
    const esc = await app.inject({ method: "POST", url: `/api/requests/${id}/escalate`, payload: { incidentType: "hazard", note: "Tree across the road", deviceToken: "d1" } });
    expect(esc.statusCode).toBe(201);
    const webReports = await ctx.db.select().from(reports).where(eq(reports.source, "web"));
    expect(webReports.length).toBe(1);
  });
});
