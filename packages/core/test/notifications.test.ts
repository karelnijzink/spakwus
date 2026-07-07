// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { NotificationChannel, SegmentId, SubscriptionScope } from "@nissegroup/shared";
import type { DbContext } from "../src/db/client.js";
import { notificationSubscriptions, reports } from "../src/db/schema.js";
import { matchOrCreateIncident, reconcile } from "../src/services/reconciler.js";
import { fanOutPending } from "../src/services/notifications/fanout.js";
import type { Senders } from "../src/services/notifications/channels.js";
import { dbAvailable, setupTestDb, testConfig, truncateMutable } from "./setup.js";

const describeDb = dbAvailable ? describe : describe.skip;
const SEG: SegmentId = "squamish-whistler";
const OTHER: SegmentId = "whistler-pemberton";
const CONFIG = testConfig();

interface SpyCall {
  channel: NotificationChannel;
  target: string;
  title: string;
}

function spySenders(): { senders: Senders; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const mk = (channel: NotificationChannel) => ({
    send: async (target: string, msg: { title: string }) => {
      calls.push({ channel, target, title: msg.title });
    },
  });
  const senders: Senders = {
    byChannel: { webpush: mk("webpush"), email: mk("email"), telegram: mk("telegram"), sms: mk("sms") },
    available: new Set<NotificationChannel>(["webpush", "email", "telegram", "sms"]),
  };
  return { senders, calls };
}

// A quiet-hours instant (23:30 Pacific) and a daytime instant (13:00 Pacific).
const QUIET_NIGHT = new Date("2026-07-07T06:30:00Z");
const DAYTIME = new Date("2026-07-07T20:00:00Z");

describeDb("notifications fan-out (integration)", () => {
  let ctx: DbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  });
  afterEach(async () => {
    await ctx.sql`TRUNCATE notification_deliveries, notification_subscriptions RESTART IDENTITY CASCADE`;
    await truncateMutable(ctx);
  });
  afterAll(async () => {
    await ctx.sql.end();
  });

  async function subscribe(channel: NotificationChannel, scope: SubscriptionScope, segmentId: SegmentId | null, quiet = false) {
    await ctx.db.insert(notificationSubscriptions).values({
      channel,
      scope,
      segmentId,
      direction: "both",
      target: `${channel}:${randomUUID()}`,
      targetKey: randomUUID(),
      verified: true,
      quietHours: quiet,
      unsubscribeToken: randomUUID(),
      active: true,
    });
  }

  async function stewardClose(segmentId: SegmentId) {
    const [r] = await ctx.db
      .insert(reports)
      .values({ segmentId, source: "steward", kind: "closure", reporterId: `s-${randomUUID()}`, isSteward: true })
      .returning();
    await matchOrCreateIncident(ctx, r!, new Date());
    await reconcile(ctx, { cause: "test", actor: "test" });
  }

  async function fan(now: Date, senders: Senders) {
    return fanOutPending({ ctx, senders, config: CONFIG, now });
  }

  it("notifies each subscriber exactly once per status flip, and is idempotent", async () => {
    await subscribe("webpush", "corridor", null);
    await subscribe("email", "corridor", null);
    await reconcile(ctx, { cause: "baseline", actor: "system" });

    const { senders, calls } = spySenders();
    await fan(DAYTIME, senders); // clears null->OPEN baselines (no sends)
    expect(calls).toHaveLength(0);

    await stewardClose(SEG); // OPEN -> CLOSED
    await fan(DAYTIME, senders);
    const closed = calls.filter((c) => c.title.includes("CLOSED"));
    expect(closed).toHaveLength(2); // one per subscriber

    // Running again must not resend (per-subscriber per-flip de-dup).
    await fan(DAYTIME, senders);
    expect(calls.filter((c) => c.title.includes("CLOSED"))).toHaveLength(2);
  });

  it("NEVER fires off a single unconfirmed report (no flip, no alert)", async () => {
    await subscribe("webpush", "corridor", null);
    await reconcile(ctx, { cause: "baseline", actor: "system" });
    const { senders, calls } = spySenders();
    await fan(DAYTIME, senders);

    // A lone anon web report stays OPEN — no status_changes flip is written.
    const [r] = await ctx.db
      .insert(reports)
      .values({ segmentId: SEG, source: "web", kind: "single-lane", reporterId: "anon", isSteward: false, trustLevel: "anon" })
      .returning();
    await matchOrCreateIncident(ctx, r!, new Date());
    await reconcile(ctx, { cause: "web", actor: "web" });
    await fan(DAYTIME, senders);

    expect(calls).toHaveLength(0);
  });

  it("fires on a clear (CLOSED -> OPEN)", async () => {
    await subscribe("webpush", "corridor", null);
    await reconcile(ctx, { cause: "baseline", actor: "system" });
    const { senders, calls } = spySenders();
    await fan(DAYTIME, senders);
    await stewardClose(SEG);
    await fan(DAYTIME, senders);

    // Clear the closure.
    await ctx.db.update(reports).set({ active: false }).where(eq(reports.segmentId, SEG));
    await reconcile(ctx, { cause: "clear", actor: "test" });
    await fan(DAYTIME, senders);

    expect(calls.some((c) => c.title.includes("reopened"))).toBe(true);
  });

  it("quiet hours suppress a PARTIAL alert but a CLOSURE always sends", async () => {
    // PARTIAL during quiet hours -> suppressed.
    await subscribe("webpush", "corridor", null, true);
    await reconcile(ctx, { cause: "baseline", actor: "system" });
    const s1 = spySenders();
    await fan(QUIET_NIGHT, s1.senders);
    // Two independent community reports corroborate to PARTIAL (single-lane is a
    // genuine restriction; a plain "delay" advisory would stay OPEN).
    for (const who of ["a", "b"]) {
      await ctx.db.insert(reports).values({ segmentId: SEG, source: "community", kind: "single-lane", reporterId: who, isSteward: false });
    }
    await reconcile(ctx, { cause: "test", actor: "test" });
    await fan(QUIET_NIGHT, s1.senders);
    expect(s1.calls.filter((c) => c.title.includes("restricted"))).toHaveLength(0);

    // A closure during the same quiet hours still sends.
    await stewardClose(SEG); // PARTIAL -> CLOSED
    await fan(QUIET_NIGHT, s1.senders);
    expect(s1.calls.filter((c) => c.title.includes("CLOSED"))).toHaveLength(1);
  });

  it("a segment subscription only receives alerts for its segment", async () => {
    await subscribe("webpush", "segment", SEG);
    await reconcile(ctx, { cause: "baseline", actor: "system" });
    const { senders, calls } = spySenders();
    await fan(DAYTIME, senders);

    await stewardClose(OTHER);
    await fan(DAYTIME, senders);
    expect(calls).toHaveLength(0); // not my segment

    await stewardClose(SEG);
    await fan(DAYTIME, senders);
    expect(calls.filter((c) => c.title.includes("CLOSED"))).toHaveLength(1);
  });
});
