// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DbContext } from "../src/db/client.js";
import { reports } from "../src/db/schema.js";
import { buildServer } from "../src/api/server.js";
import { matchOrCreateIncident, reconcile } from "../src/services/reconciler.js";
import { dbAvailable, setupTestDb, testConfig, truncateMutable } from "./setup.js";

const describeDb = dbAvailable ? describe : describe.skip;

describeDb("read API (integration)", () => {
  let ctx: DbContext;
  let app: FastifyInstance;

  beforeAll(async () => {
    ctx = await setupTestDb();
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

  async function seedClosure() {
    const [row] = await ctx.db
      .insert(reports)
      .values({
        segmentId: "squamish-whistler",
        source: "steward",
        kind: "closure",
        reporterId: "steward-1",
        isSteward: true,
        rawText: "Highway 99 closed at Tantalus.",
        summary: "Highway 99 closed at Tantalus.",
      })
      .returning();
    await matchOrCreateIncident(ctx, row!, new Date());
    await reconcile(ctx, { cause: "test", actor: "test" });
  }

  it("GET /api/status returns corridor + per-segment with provenance", async () => {
    await seedClosure();
    const res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Corridor provenance: source + confidence + timestamp all present.
    expect(body.source).toBe("steward");
    expect(body.timestamp).toBeTruthy();
    expect(body.status).toBe("CLOSED");
    expect(body.confidence).toBeTruthy();
    expect(body.segments).toHaveLength(3);

    const seg = body.segments.find((s: { segmentId: string }) => s.segmentId === "squamish-whistler");
    expect(seg.status).toBe("CLOSED");
    expect(seg.source).toBe("steward");
    expect(seg.confidence).toBeTruthy();
    expect(seg.updatedAt).toBeTruthy();
  });

  it("GET /api/incidents?active=1 returns incidents with nested reports", async () => {
    await seedClosure();
    const res = await app.inject({ method: "GET", url: "/api/incidents?active=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.source).toBe("spakwus");
    expect(body.incidents.length).toBe(1);
    const inc = body.incidents[0];
    expect(inc.segmentId).toBe("squamish-whistler");
    expect(inc.confidence).toBeTruthy();
    expect(inc.source).toBeTruthy();
    expect(inc.startedAt).toBeTruthy();
    expect(inc.reports.length).toBe(1);
    expect(inc.reports[0].source).toBe("steward");
    expect(inc.reports[0].createdAt).toBeTruthy();
  });

  it("GET /api/webcams returns seeded DriveBC cameras with provenance", async () => {
    const res = await app.inject({ method: "GET", url: "/api/webcams" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe("drivebc");
    expect(body.webcams.length).toBeGreaterThanOrEqual(3);
    expect(body.webcams[0].source).toBe("drivebc");
    expect(body.webcams[0].confidence).toBeTruthy();
  });

  it("GET /api/status/snapshot returns a compact cacheable object", async () => {
    await seedClosure();
    const res = await app.inject({ method: "GET", url: "/api/status/snapshot" });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.source).toBe("spakwus");
    expect(body.generatedAt).toBeTruthy();
    expect(body.confidence).toBeTruthy();
    expect(body.corridor.status).toBe("CLOSED");
    expect(body.segments).toHaveLength(3);
    expect(Array.isArray(body.webcams)).toBe(true);
    expect(typeof body.incidents).toBe("number");
  });
});
