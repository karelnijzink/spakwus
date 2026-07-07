// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DbContext } from "../src/db/client.js";
import { buildServer } from "../src/api/server.js";
import { getHistoryStats } from "../src/services/history.js";
import { HealthRegistry } from "../src/services/health.js";
import { dbAvailable, setupTestDb, testConfig } from "./setup.js";

const describeDb = dbAvailable ? describe : describe.skip;

describeDb("history + health (integration)", () => {
  let ctx: DbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  });
  beforeEach(async () => {
    await ctx.sql`TRUNCATE historical_events`;
  });
  afterAll(async () => {
    await ctx.sql.end();
  });

  async function seedHistory() {
    // Two closures (30m and 90m) and one non-closure on Squamish→Whistler,
    // one closure on Whistler→Pemberton (across two months).
    const rows = [
      { id: "h1", seg: "squamish-whistler", closure: true, start: "2025-01-05T08:00:00Z", end: "2025-01-05T08:30:00Z", dur: 30 },
      { id: "h2", seg: "squamish-whistler", closure: true, start: "2025-01-20T10:00:00Z", end: "2025-01-20T11:30:00Z", dur: 90 },
      { id: "h3", seg: "squamish-whistler", closure: false, start: "2025-02-01T09:00:00Z", end: "2025-02-01T09:20:00Z", dur: 20 },
      { id: "h4", seg: "whistler-pemberton", closure: true, start: "2025-02-10T07:00:00Z", end: "2025-02-10T08:00:00Z", dur: 60 },
    ];
    for (const r of rows) {
      await ctx.sql`
        INSERT INTO historical_events (id, event_type, is_closure, road_name, segment_id, started_at, ended_at, duration_minutes)
        VALUES (${r.id}, 'INCIDENT', ${r.closure}, 'Highway 99', ${r.seg},
                ${r.start}::timestamptz, ${r.end}::timestamptz, ${r.dur})`;
    }
  }

  it("computes closures/month, worst segments, and typical durations", async () => {
    await seedHistory();
    const stats = await getHistoryStats(ctx);

    expect(stats.coverage.totalEvents).toBe(4);
    expect(stats.coverage.totalClosures).toBe(3);

    const jan = stats.closuresByMonth.find((m) => m.month === "2025-01");
    expect(jan?.closures).toBe(2);
    const feb = stats.closuresByMonth.find((m) => m.month === "2025-02");
    expect(feb?.closures).toBe(1); // h3 is not a closure

    // Squamish→Whistler has the most closures → ranked first.
    expect(stats.worstSegments[0]?.segmentId).toBe("squamish-whistler");
    expect(stats.worstSegments[0]?.closures).toBe(2);
    expect(stats.worstSegments[0]?.medianClosureMinutes).toBe(60); // median(30,90)

    // Overall closure durations: 30, 90, 60 → median 60.
    expect(stats.typicalClosureDuration.sampleSize).toBe(3);
    expect(stats.typicalClosureDuration.medianMinutes).toBe(60);
  });

  it("is empty (not an error) before any data is loaded", async () => {
    const stats = await getHistoryStats(ctx);
    expect(stats.coverage.totalEvents).toBe(0);
    expect(stats.closuresByMonth).toEqual([]);
    expect(stats.worstSegments).toEqual([]);
    expect(stats.typicalClosureDuration.sampleSize).toBe(0);
  });

  it("GET /api/history/stats serves the stats with provenance", async () => {
    await seedHistory();
    const app: FastifyInstance = buildServer({ ctx, config: testConfig() });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/history/stats" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe("drivebc-historical");
    expect(body.coverage.totalClosures).toBe(3);
    await app.close();
  });

  it("GET /api/health reports DB reachable + all workers when workers are disabled", async () => {
    const health = new HealthRegistry();
    const app: FastifyInstance = buildServer({
      ctx,
      config: testConfig({ ENABLE_WORKERS: "false" }),
      health,
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    // With workers disabled they aren't judged stale, so the system reads healthy.
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dependencies.database.ok).toBe(true);
    expect(Array.isArray(body.workers)).toBe(true);
    expect(body.workers.length).toBe(5);
    expect(body.open511).toHaveProperty("fresh");
    await app.close();
  });
});
