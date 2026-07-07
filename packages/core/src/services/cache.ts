// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { RedisClient } from "../redis/client.js";

const CACHE_PREFIX = "spakwus:cache:";

/**
 * Race a Redis op against a short timeout so a slow/unresponsive Redis can never
 * stall the read path. On timeout (or any error) we treat it as a cache miss and
 * fall through to the source of truth — the cache is an optimization, never a
 * dependency.
 */
function withTimeout<T>(op: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    op,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("redis timeout")), ms)),
  ]);
}

/**
 * Read-through cache for hot, cheap-to-serve-stale read endpoints. Serves a
 * cached JSON value when present, otherwise runs `fn`, stores the result with a
 * short TTL, and returns it.
 *
 * Fails OPEN in every direction: if Redis is unavailable (or `redis`/`ttlSec`
 * is unset) it degrades to a plain call of `fn`, so a Redis outage can never
 * take down the read path — it only removes the cache.
 */
export async function cached<T>(
  redis: RedisClient | undefined,
  key: string,
  ttlSec: number,
  fn: () => Promise<T>,
): Promise<T> {
  if (!redis || ttlSec <= 0) return fn();

  const fullKey = `${CACHE_PREFIX}${key}`;
  try {
    const hit = await withTimeout(redis.get(fullKey), 250);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    // Cache read failed/timed out — fall through to the source of truth.
  }

  const value = await fn();

  try {
    await withTimeout(redis.set(fullKey, JSON.stringify(value), "EX", ttlSec), 250);
  } catch {
    // Best-effort write; the value is still returned.
  }
  return value;
}

/**
 * Invalidate the status read caches. Called right after a reconcile writes new
 * `segment_status`, so a status flip is reflected immediately rather than after
 * the TTL. Best-effort — a missed bust only means one stale-window of latency.
 */
export async function bustStatusCache(redis: RedisClient | undefined): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(`${CACHE_PREFIX}status`, `${CACHE_PREFIX}snapshot`);
  } catch {
    // best-effort
  }
}
