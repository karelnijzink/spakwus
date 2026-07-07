// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbContext } from "../src/db/client.js";
import { reports, segmentStatus } from "../src/db/schema.js";
import { runOpen511Poll } from "../src/workers/open511-poller.js";
import type { Open511Response } from "../src/open511/types.js";
import { dbAvailable, setupTestDb, truncateMutable } from "./setup.js";

const describeDb = dbAvailable ? describe : describe.skip;

/** A fake fetch that serves a queue of Open511 pages, then empty pages. */
function fakeFetch(pages: Open511Response[]): typeof fetch {
  let call = 0;
  return (async () => {
    const body = pages[call] ?? { events: [] };
    call += 1;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
}

// A closure event on the Squamish -> Whistler segment.
const closureEvent = {
  id: "DBC/CLOSURE-1",
  status: "ACTIVE",
  headline: "Highway 99 closed",
  description: "Highway 99 closed in both directions due to an incident.",
  roads: [{ name: "Highway 99", state: "CLOSED" }],
  geography: { type: "Point" as const, coordinates: [-123.1, 49.95] as [number, number] },
  created: "2026-07-06T10:00:00Z",
  updated: "2026-07-06T11:30:00Z",
};

describeDb("open511 poller (integration)", () => {
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

  it("ingests a paginated active closure, assigns the segment, and derives CLOSED", async () => {
    const pages: Open511Response[] = [
      { events: [closureEvent], pagination: { next_url: "PAGE2" } },
      { events: [], pagination: { next_url: null } },
    ];

    const result = await runOpen511Poll({
      ctx,
      open511Url: "https://example.test/events",
      fetchFn: fakeFetch(pages),
    });

    expect(result.upserted).toBe(1);

    const rows = await ctx.db.select().from(reports).where(eq(reports.source, "open511"));
    expect(rows.length).toBe(1);
    expect(rows[0]?.segmentId).toBe("squamish-whistler");
    expect(rows[0]?.kind).toBe("closure");
    expect(rows[0]?.externalId).toBe("DBC/CLOSURE-1");

    const [status] = await ctx.db
      .select()
      .from(segmentStatus)
      .where(eq(segmentStatus.segmentId, "squamish-whistler"));
    expect(status?.status).toBe("CLOSED");
    expect(status?.source).toBe("official");
  });

  it("is idempotent on the external id (upsert, not duplicate)", async () => {
    const pages: Open511Response[] = [{ events: [closureEvent], pagination: { next_url: null } }];
    await runOpen511Poll({ ctx, open511Url: "https://example.test/events", fetchFn: fakeFetch(pages) });
    await runOpen511Poll({ ctx, open511Url: "https://example.test/events", fetchFn: fakeFetch(pages) });

    const rows = await ctx.db.select().from(reports).where(eq(reports.source, "open511"));
    expect(rows.length).toBe(1);
  });

  it("archives an event that drops out of the active feed and reopens the segment", async () => {
    await runOpen511Poll({
      ctx,
      open511Url: "https://example.test/events",
      fetchFn: fakeFetch([{ events: [closureEvent], pagination: { next_url: null } }]),
    });
    // Next poll: the feed no longer includes the event.
    await runOpen511Poll({
      ctx,
      open511Url: "https://example.test/events",
      fetchFn: fakeFetch([{ events: [], pagination: { next_url: null } }]),
    });

    const rows = await ctx.db.select().from(reports).where(eq(reports.source, "open511"));
    expect(rows[0]?.active).toBe(false);

    const [status] = await ctx.db
      .select()
      .from(segmentStatus)
      .where(eq(segmentStatus.segmentId, "squamish-whistler"));
    expect(status?.status).toBe("OPEN");
  });
});
