// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { Redis } from "ioredis";

export type RedisClient = Redis;

export function createRedis(url: string): RedisClient {
  const redis = new Redis(url, {
    // Every Redis caller in Spakwus fails OPEN (cache, rate limit, token set), so
    // when Redis is down we want commands to reject *immediately* rather than sit
    // in the offline queue waiting for a reconnect — a queued command can hang the
    // request for a long time, which on a hot read path (the status cache) would
    // stall responses. Fail fast; the caller's catch handles it.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    // Keep trying to reconnect (with a capped backoff) so Redis recovers on its own.
    retryStrategy: (times) => Math.min(times * 300, 5000),
  });
  // No unhandled 'error' spam: connection failures are expected and non-fatal.
  redis.on("error", () => {});
  return redis;
}

export const REDIS_KEYS = {
  open511Raw: "spakwus:open511:raw",
  webcamPrefix: "spakwus:webcam:",
  knownTokens: "spakwus:tokens:known",
  ratePrefix: "spakwus:rl:",
} as const;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Fixed-window rate limit via INCR + EXPIRE. Fails OPEN (allows) if Redis is
 * unavailable — availability of the read/report path matters more than a hard
 * limit, and abuse is bounded by the DB moderation queue anyway.
 */
export async function rateLimit(
  redis: RedisClient,
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  try {
    const n = await redis.incr(`${REDIS_KEYS.ratePrefix}${key}`);
    if (n === 1) await redis.expire(`${REDIS_KEYS.ratePrefix}${key}`, windowSec);
    return { allowed: n <= limit, remaining: Math.max(0, limit - n) };
  } catch {
    return { allowed: true, remaining: limit };
  }
}

/** Whether a device token has been seen before (returning reporter). */
export async function isKnownToken(redis: RedisClient, token: string): Promise<boolean> {
  try {
    return (await redis.sismember(REDIS_KEYS.knownTokens, token)) === 1;
  } catch {
    return false;
  }
}

export async function rememberToken(redis: RedisClient, token: string): Promise<void> {
  try {
    await redis.sadd(REDIS_KEYS.knownTokens, token);
  } catch {
    // best-effort
  }
}
