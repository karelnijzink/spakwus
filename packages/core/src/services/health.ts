// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { DbContext } from "../db/client.js";
import type { RedisClient } from "../redis/client.js";
import type { Config } from "../config.js";
import { REDIS_KEYS } from "../redis/client.js";

export type WorkerName =
  | "open511-poller"
  | "webcam-fetcher"
  | "notifier"
  | "request-expirer"
  | "snapshot-publisher"
  | "health-monitor";

export interface WorkerHealth {
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  runs: number;
  failures: number;
  /** Free-form last-run detail, e.g. "fetched=3 active=1". */
  detail: string | null;
}

function blank(): WorkerHealth {
  return {
    lastRunAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    runs: 0,
    failures: 0,
    detail: null,
  };
}

/**
 * In-process worker heartbeat registry. All workers run in a single Node
 * process, so a shared in-memory object is the simplest reliable store — no
 * round-trip, no serialization, survives a Redis outage. The `/api/health`
 * endpoint reads it plus live DB/Redis probes.
 */
export class HealthRegistry {
  private readonly startedAt = new Date().toISOString();
  private readonly workers = new Map<WorkerName, WorkerHealth>();

  private slot(name: WorkerName): WorkerHealth {
    let w = this.workers.get(name);
    if (!w) {
      w = blank();
      this.workers.set(name, w);
    }
    return w;
  }

  /** Register a worker as "expected" so it shows as pending before its first run. */
  register(name: WorkerName): void {
    this.slot(name);
  }

  markStart(name: WorkerName, now: Date = new Date()): void {
    const w = this.slot(name);
    w.lastRunAt = now.toISOString();
    w.runs += 1;
  }

  markSuccess(name: WorkerName, detail?: string, now: Date = new Date()): void {
    const w = this.slot(name);
    w.lastSuccessAt = now.toISOString();
    if (detail !== undefined) w.detail = detail;
  }

  markError(name: WorkerName, err: unknown, now: Date = new Date()): void {
    const w = this.slot(name);
    w.lastErrorAt = now.toISOString();
    w.lastError = err instanceof Error ? err.message : String(err);
    w.failures += 1;
  }

  get(name: WorkerName): WorkerHealth {
    return { ...this.slot(name) };
  }

  bootTime(): string {
    return this.startedAt;
  }

  snapshot(): Record<string, WorkerHealth> {
    const out: Record<string, WorkerHealth> = {};
    for (const [name, health] of this.workers) out[name] = { ...health };
    return out;
  }
}

export interface DependencyHealth {
  ok: boolean;
  detail: string | null;
}

export interface WorkerHealthView extends WorkerHealth {
  name: string;
  ok: boolean;
  /** Seconds since the last successful run, or null if it has never succeeded. */
  ageSec: number | null;
  stale: boolean;
}

export interface HealthReport {
  ok: boolean;
  product: string;
  bootedAt: string;
  now: string;
  workersEnabled: boolean;
  dependencies: { database: DependencyHealth; redis: DependencyHealth };
  open511: {
    lastSuccessfulPollAt: string | null;
    lastEventUpdatedAt: string | null;
    ageSec: number | null;
    staleThresholdSec: number;
    fresh: boolean;
  };
  community: { expirerHealthy: boolean; lastRunAt: string | null };
  workers: WorkerHealthView[];
}

function ageSeconds(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.round((now.getTime() - t) / 1000));
}

/**
 * A worker is healthy when it has succeeded and its last run did not end in an
 * error more recent than its last success. Freshness (staleness) is judged per
 * worker against a threshold derived from its poll interval.
 */
function viewFor(
  name: WorkerName,
  health: WorkerHealth,
  now: Date,
  staleThresholdSec: number,
  workersEnabled: boolean,
): WorkerHealthView {
  const ageSec = ageSeconds(health.lastSuccessAt, now);
  const erroredSinceSuccess =
    !!health.lastErrorAt &&
    (!health.lastSuccessAt || new Date(health.lastErrorAt) > new Date(health.lastSuccessAt));
  const stale = workersEnabled && (ageSec === null || ageSec > staleThresholdSec);
  const ok = !workersEnabled ? true : !stale && !erroredSinceSuccess;
  return { name, ...health, ok, ageSec, stale };
}

/**
 * Compose the public health + freshness report: worker heartbeats, Open511
 * freshness (last successful poll and the newest event we hold), and live DB +
 * Redis probes. Everything here is safe to expose publicly.
 */
export async function readHealth(
  ctx: DbContext,
  redis: RedisClient | undefined,
  registry: HealthRegistry,
  config: Config,
  now: Date = new Date(),
): Promise<HealthReport> {
  // Live DB probe + newest Open511 event timestamp in one round-trip.
  let database: DependencyHealth = { ok: false, detail: null };
  let lastEventUpdatedAt: string | null = null;
  try {
    const rows = await ctx.sql<{ last_event: Date | string | null }[]>`
      SELECT max(updated_at) AS last_event FROM reports WHERE source = 'open511' AND active = true`;
    database = { ok: true, detail: null };
    const v = rows[0]?.last_event ?? null;
    lastEventUpdatedAt = v ? new Date(v).toISOString() : null;
  } catch (err) {
    database = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  let redisHealth: DependencyHealth = { ok: false, detail: "not configured" };
  let open511RawFetchedAt: string | null = null;
  if (redis) {
    try {
      await redis.ping();
      redisHealth = { ok: true, detail: null };
      const raw = await redis.get(REDIS_KEYS.open511Raw);
      if (raw) {
        const parsed = JSON.parse(raw) as { fetchedAt?: string };
        open511RawFetchedAt = parsed.fetchedAt ?? null;
      }
    } catch (err) {
      redisHealth = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  const workersEnabled = config.ENABLE_WORKERS;
  const pollerHealth = registry.get("open511-poller");
  const lastSuccessfulPollAt = pollerHealth.lastSuccessAt ?? open511RawFetchedAt;
  const open511AgeSec = ageSeconds(lastSuccessfulPollAt, now);

  const staleFor: Record<WorkerName, number> = {
    "open511-poller": config.OPEN511_STALE_ALERT_SEC,
    "webcam-fetcher": Math.round((config.WEBCAM_REFRESH_MS / 1000) * 4),
    notifier: Math.round((config.NOTIFY_POLL_MS / 1000) * 6),
    "request-expirer": 20 * 60,
    "snapshot-publisher": Math.round((config.SNAPSHOT_PUBLISH_MS / 1000) * 4),
    "health-monitor": Math.round((config.HEALTH_MONITOR_MS / 1000) * 4),
  };

  const names: WorkerName[] = [
    "open511-poller",
    "webcam-fetcher",
    "notifier",
    "request-expirer",
    "snapshot-publisher",
  ];
  const workers = names.map((n) => viewFor(n, registry.get(n), now, staleFor[n], workersEnabled));

  const expirer = registry.get("request-expirer");
  const expirerView = viewFor("request-expirer", expirer, now, staleFor["request-expirer"], workersEnabled);

  const ok = database.ok && workers.every((w) => w.ok);

  return {
    ok,
    product: "Spakwus",
    bootedAt: registry.bootTime(),
    now: now.toISOString(),
    workersEnabled,
    dependencies: { database, redis: redisHealth },
    open511: {
      lastSuccessfulPollAt,
      lastEventUpdatedAt,
      ageSec: open511AgeSec,
      staleThresholdSec: config.OPEN511_STALE_ALERT_SEC,
      fresh: !workersEnabled ? true : open511AgeSec !== null && open511AgeSec <= config.OPEN511_STALE_ALERT_SEC,
    },
    community: { expirerHealthy: expirerView.ok, lastRunAt: expirer.lastRunAt },
    workers,
  };
}
