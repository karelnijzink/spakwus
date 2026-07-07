// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { eq } from "drizzle-orm";
import type { DbContext } from "../db/client.js";
import { webcams } from "../db/schema.js";
import type { RedisClient } from "../redis/client.js";
import { REDIS_KEYS } from "../redis/client.js";
import type { FetchFn } from "../open511/client.js";
import type { HealthRegistry } from "../services/health.js";
import { consoleLogger, type Logger } from "./logger.js";

export interface WebcamFetcherDeps {
  ctx: DbContext;
  redis?: RedisClient;
  fetchFn?: FetchFn;
  log?: Logger;
  health?: HealthRegistry;
}

export interface WebcamRefreshResult {
  checked: number;
  refreshed: number;
}

/**
 * Refresh every active DriveBC webcam: probe the image URL, record a capture
 * timestamp (the HTTP Last-Modified when available, else now), and store a
 * cache-busted URL clients can fetch. Best-effort per camera — a failing camera
 * does not abort the batch.
 */
export async function runWebcamRefresh(deps: WebcamFetcherDeps): Promise<WebcamRefreshResult> {
  const { ctx, redis } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const log = deps.log ?? consoleLogger;

  const cams = await ctx.db.select().from(webcams).where(eq(webcams.active, true));
  let refreshed = 0;

  for (const cam of cams) {
    const now = new Date();
    let capturedAt = now;
    try {
      const res = await fetchFn(cam.imageUrl, { method: "HEAD" });
      const lastModified = res.headers.get("last-modified");
      if (lastModified) {
        const parsed = new Date(lastModified);
        if (!Number.isNaN(parsed.getTime())) capturedAt = parsed;
      }
    } catch (err) {
      // Probe failed; still bump the capture time so the client gets a fresh
      // URL, but note it.
      log.warn(`webcam-fetcher: HEAD failed for ${cam.id}`, err);
    }

    const lastImageUrl = `${cam.imageUrl}${cam.imageUrl.includes("?") ? "&" : "?"}t=${capturedAt.getTime()}`;

    await ctx.db
      .update(webcams)
      .set({ lastCapturedAt: capturedAt, lastImageUrl })
      .where(eq(webcams.id, cam.id));

    if (redis) {
      try {
        await redis.set(
          `${REDIS_KEYS.webcamPrefix}${cam.id}`,
          JSON.stringify({ capturedAt: capturedAt.toISOString(), url: lastImageUrl }),
          "EX",
          600,
        );
      } catch (err) {
        log.warn(`webcam-fetcher: Redis cache failed for ${cam.id}`, err);
      }
    }

    refreshed += 1;
  }

  const result = { checked: cams.length, refreshed };
  log.info(`webcam-fetcher: checked=${result.checked} refreshed=${result.refreshed}`);
  return result;
}

/** Start the recurring webcam refresher. Returns a stop function. */
export function startWebcamFetcher(deps: WebcamFetcherDeps, intervalMs: number): () => void {
  const log = deps.log ?? consoleLogger;
  const health = deps.health;
  health?.register("webcam-fetcher");
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    health?.markStart("webcam-fetcher");
    try {
      const r = await runWebcamRefresh(deps);
      health?.markSuccess("webcam-fetcher", `checked=${r.checked} refreshed=${r.refreshed}`);
    } catch (err) {
      log.error("webcam-fetcher: refresh failed", err);
      health?.markError("webcam-fetcher", err);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
