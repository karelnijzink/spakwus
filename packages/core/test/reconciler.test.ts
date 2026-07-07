// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { SegmentId } from "@nissegroup/shared";
import type { DbContext } from "../src/db/client.js";
import { incidents, reports, segmentStatus, statusChanges } from "../src/db/schema.js";
import { matchOrCreateIncident, reconcile } from "../src/services/reconciler.js";
import { dbAvailable, setupTestDb, truncateMutable } from "./setup.js";

const SEG: SegmentId = "squamish-whistler";
const describeDb = dbAvailable ? describe : describe.skip;

interface InsertReportArgs {
  segmentId?: SegmentId;
  source?: "open511" | "community" | "steward";
  kind?: "closure" | "single-lane" | "alternating" | "delay" | "clear";
  reporterId: string;
  isSteward?: boolean;
  createdAt?: Date;
}

describeDb("reconciler (integration)", () => {
  let ctx: DbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  });
  afterEach(async () => {
    await truncateMutable(ctx);
  });
  afterAll(async () => {
    await ctx.sql.end();
  });

  async function insertReport(args: InsertReportArgs): Promise<string> {
    const [row] = await ctx.db
      .insert(reports)
      .values({
        segmentId: args.segmentId ?? SEG,
        source: args.source ?? "community",
        kind: args.kind ?? "closure",
        reporterId: args.reporterId,
        isSteward: args.isSteward ?? false,
        createdAt: args.createdAt ?? new Date(),
      })
      .returning({ id: reports.id });
    return row!.id;
  }

  async function statusOf(segmentId: SegmentId) {
    const [row] = await ctx.db
      .select()
      .from(segmentStatus)
      .where(eq(segmentStatus.segmentId, segmentId));
    return row;
  }

  it("two independent community closures -> CLOSED (confirmed)", async () => {
    await insertReport({ reporterId: "alice", createdAt: new Date(Date.now() - 20 * 60_000) });
    await insertReport({ reporterId: "bob" });
    await reconcile(ctx, { cause: "test", actor: "test" });

    const s = await statusOf(SEG);
    expect(s?.status).toBe("CLOSED");
    expect(s?.source).toBe("community");
    expect(s?.confidence).toBe("confirmed");
  });

  it("a single unconfirmed community closure stays OPEN", async () => {
    await insertReport({ reporterId: "alice" });
    await reconcile(ctx, { cause: "test", actor: "test" });

    const s = await statusOf(SEG);
    expect(s?.status).toBe("OPEN");
    expect(s?.confidence).toBe("unconfirmed");
  });

  it("a single steward closure -> CLOSED", async () => {
    await insertReport({ reporterId: "steward-1", source: "steward", isSteward: true });
    await reconcile(ctx, { cause: "test", actor: "test" });

    const s = await statusOf(SEG);
    expect(s?.status).toBe("CLOSED");
    expect(s?.source).toBe("steward");
  });

  it("records a status_changes row on every flip", async () => {
    // First reconcile: baseline OPEN (null -> OPEN).
    await reconcile(ctx, { cause: "startup", actor: "system" });
    // Then a confirmed closure flips OPEN -> CLOSED.
    await insertReport({ reporterId: "alice", source: "steward", isSteward: true });
    await reconcile(ctx, { cause: "report", actor: "reconciler" });

    const changes = await ctx.db
      .select()
      .from(statusChanges)
      .where(eq(statusChanges.segmentId, SEG));
    const toStates = changes.map((c) => c.toState);
    expect(toStates).toContain("OPEN");
    expect(toStates).toContain("CLOSED");
    const flip = changes.find((c) => c.toState === "CLOSED");
    expect(flip?.fromState).toBe("OPEN");
  });

  it("does not append a status_changes row when status is unchanged", async () => {
    await reconcile(ctx, { cause: "startup", actor: "system" });
    await reconcile(ctx, { cause: "startup", actor: "system" });
    const changes = await ctx.db
      .select()
      .from(statusChanges)
      .where(eq(statusChanges.segmentId, SEG));
    // Only the initial null -> OPEN, no duplicate.
    expect(changes.length).toBe(1);
  });

  it("groups two nearby reports of the same kind into one incident", async () => {
    const id1 = await insertReport({ reporterId: "alice" });
    const [r1] = await ctx.db.select().from(reports).where(eq(reports.id, id1));
    const inc1 = await matchOrCreateIncident(ctx, r1!, new Date());

    const id2 = await insertReport({ reporterId: "bob" });
    const [r2] = await ctx.db.select().from(reports).where(eq(reports.id, id2));
    const inc2 = await matchOrCreateIncident(ctx, r2!, new Date());

    expect(inc1).toBe(inc2);
    const allIncidents = await ctx.db
      .select()
      .from(incidents)
      .where(and(eq(incidents.segmentId, SEG), eq(incidents.active, true)));
    expect(allIncidents.length).toBe(1);
  });

  it("a steward 'clear' report ends active incidents on the segment", async () => {
    const id1 = await insertReport({ reporterId: "alice" });
    const [r1] = await ctx.db.select().from(reports).where(eq(reports.id, id1));
    await matchOrCreateIncident(ctx, r1!, new Date());

    const clearId = await insertReport({
      reporterId: "steward-1",
      source: "steward",
      isSteward: true,
      kind: "clear",
    });
    const [clr] = await ctx.db.select().from(reports).where(eq(reports.id, clearId));
    await matchOrCreateIncident(ctx, clr!, new Date());

    const active = await ctx.db
      .select()
      .from(incidents)
      .where(and(eq(incidents.segmentId, SEG), eq(incidents.active, true)));
    expect(active.length).toBe(0);
  });
});
