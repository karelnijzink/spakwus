// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { DbContext } from "../db/client.js";
import type { Config } from "../config.js";
import type { HealthRegistry } from "../services/health.js";
import { buildSnapshot, snapshotSignature } from "../services/snapshot.js";
import { publishSnapshot } from "../services/publisher.js";
import { consoleLogger, type Logger } from "./logger.js";

export interface SnapshotPublisherDeps {
  ctx: DbContext;
  config: Config;
  log?: Logger;
  health?: HealthRegistry;
}

/**
 * Keeps the CDN-hosted static fallback (`status-fallback.json`) current. Rebuilds
 * the corridor snapshot on a short interval and republishes only when the
 * content signature changes — i.e. effectively "on every status change" (bounded
 * by the poll interval) without rewriting an unchanged file. Publishes once at
 * startup so the fallback exists immediately.
 */
export function startSnapshotPublisher(deps: SnapshotPublisherDeps, intervalMs: number): () => void {
  const log = deps.log ?? consoleLogger;
  const health = deps.health;
  health?.register("snapshot-publisher");
  let running = false;
  let lastSignature: string | null = null;

  const tick = async () => {
    if (running) return;
    running = true;
    health?.markStart("snapshot-publisher");
    try {
      const snap = await buildSnapshot(deps.ctx);
      const sig = snapshotSignature(snap);
      if (sig !== lastSignature) {
        const ok = await publishSnapshot(snap, deps.config, log);
        if (ok) {
          lastSignature = sig;
          log.info(`snapshot-publisher: published fallback (status=${snap.corridor.status})`);
        }
        health?.markSuccess("snapshot-publisher", `published status=${snap.corridor.status}`);
      } else {
        health?.markSuccess("snapshot-publisher", "unchanged");
      }
    } catch (err) {
      log.error("snapshot-publisher: failed", err);
      health?.markError("snapshot-publisher", err);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
