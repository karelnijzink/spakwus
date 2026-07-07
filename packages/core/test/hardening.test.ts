// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RedisClient } from "../src/redis/client.js";
import { bustStatusCache, cached } from "../src/services/cache.js";
import { snapshotSignature, type CorridorSnapshot } from "../src/services/snapshot.js";
import { publishSnapshot } from "../src/services/publisher.js";
import { HealthRegistry } from "../src/services/health.js";
import { sendOperatorAlert } from "../src/services/alerting.js";
import { loadConfig } from "../src/config.js";

/** A tiny in-memory stand-in for the bits of ioredis the cache uses. */
function fakeRedis(): { redis: RedisClient; store: Map<string, string>; sets: number } {
  const store = new Map<string, string>();
  const state = { sets: 0 };
  const redis = {
    async get(k: string) {
      return store.get(k) ?? null;
    },
    async set(k: string, v: string) {
      state.sets += 1;
      store.set(k, v);
      return "OK";
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
  } as unknown as RedisClient;
  return { redis, store, get sets() {
    return state.sets;
  } };
}

const SNAP: CorridorSnapshot = {
  source: "spakwus",
  generatedAt: "2026-07-06T00:00:00.000Z",
  confidence: "official",
  corridor: { status: "CLOSED", source: "official", confidence: "official", updatedAt: "2026-07-06T00:00:00.000Z", reason: "Rockfall" },
  segments: [
    { id: "squamish-whistler", name: "Squamish → Whistler", status: "CLOSED", source: "official", confidence: "official", updatedAt: "2026-07-06T00:00:00.000Z", reason: "Rockfall" },
  ],
  webcams: [],
  incidents: 1,
};

describe("read cache (unit)", () => {
  it("caches the first computed value and serves it on the next call", async () => {
    const { redis } = fakeRedis();
    const fn = vi.fn(async () => ({ n: 42 }));
    const a = await cached(redis, "status", 10, fn);
    const b = await cached(redis, "status", 10, fn);
    expect(a).toEqual({ n: 42 });
    expect(b).toEqual({ n: 42 });
    expect(fn).toHaveBeenCalledTimes(1); // second call was a cache hit
  });

  it("busts the status caches so a write is reflected immediately", async () => {
    const { redis } = fakeRedis();
    const fn = vi.fn(async () => ({ n: Math.random() }));
    await cached(redis, "status", 10, fn);
    await bustStatusCache(redis);
    await cached(redis, "status", 10, fn);
    expect(fn).toHaveBeenCalledTimes(2); // recomputed after the bust
  });

  it("fails open when Redis throws (never breaks the read path)", async () => {
    const brokenRedis = {
      get: async () => {
        throw new Error("redis down");
      },
      set: async () => {
        throw new Error("redis down");
      },
    } as unknown as RedisClient;
    const out = await cached(brokenRedis, "status", 10, async () => ({ ok: true }));
    expect(out).toEqual({ ok: true });
  });

  it("bypasses the cache entirely when ttl<=0 or redis is undefined", async () => {
    const fn = vi.fn(async () => 1);
    await cached(undefined, "k", 10, fn);
    await cached(fakeRedis().redis, "k", 0, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("snapshot signature (unit)", () => {
  it("ignores generatedAt but changes when status changes", () => {
    const sig1 = snapshotSignature(SNAP);
    const sig2 = snapshotSignature({ ...SNAP, generatedAt: "2030-01-01T00:00:00.000Z" });
    expect(sig1).toBe(sig2); // generatedAt excluded
    const sig3 = snapshotSignature({ ...SNAP, corridor: { ...SNAP.corridor, status: "OPEN" } });
    expect(sig3).not.toBe(sig1);
  });
});

describe("static fallback publisher (unit)", () => {
  const out = join(tmpdir(), `spakwus-fallback-${process.pid}.json`);
  afterEach(async () => {
    await rm(out, { force: true });
  });

  it("writes the last-known snapshot to the file backend", async () => {
    const config = loadConfig({ SNAPSHOT_PUBLISH: "file", SNAPSHOT_FILE: out } as NodeJS.ProcessEnv);
    const ok = await publishSnapshot(SNAP, config);
    expect(ok).toBe(true);
    const written = JSON.parse(await readFile(out, "utf8")) as CorridorSnapshot;
    expect(written.corridor.status).toBe("CLOSED");
    expect(written.corridor.reason).toBe("Rockfall");
  });

  it("does nothing when publishing is disabled", async () => {
    const config = loadConfig({ SNAPSHOT_PUBLISH: "none" } as NodeJS.ProcessEnv);
    const ok = await publishSnapshot(SNAP, config);
    expect(ok).toBe(false);
  });
});

describe("health registry (unit)", () => {
  it("tracks runs, successes, and errors per worker", () => {
    const reg = new HealthRegistry();
    reg.markStart("open511-poller");
    reg.markSuccess("open511-poller", "fetched=3");
    reg.markStart("open511-poller");
    reg.markError("open511-poller", new Error("boom"));
    const h = reg.get("open511-poller");
    expect(h.runs).toBe(2);
    expect(h.failures).toBe(1);
    expect(h.detail).toBe("fetched=3");
    expect(h.lastError).toBe("boom");
    expect(reg.snapshot()["open511-poller"]).toBeTruthy();
  });
});

describe("operator alerting (unit)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts { text } to the generic webhook sink", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const config = loadConfig({ OPERATOR_WEBHOOK_URL: "https://hook.example/x" } as NodeJS.ProcessEnv);
    await sendOperatorAlert(config, undefined, "DOWN: database", "unreachable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1]!;
    expect(JSON.parse(init.body as string).text).toContain("DOWN: database");
  });

  it("no-ops safely when no sink is configured", async () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    await expect(sendOperatorAlert(config, undefined, "x", "y")).resolves.toBeUndefined();
  });
});
