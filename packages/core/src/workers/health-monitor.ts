// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { DbContext } from "../db/client.js";
import type { RedisClient } from "../redis/client.js";
import type { Config } from "../config.js";
import type { Senders } from "../services/notifications/channels.js";
import { HealthRegistry, readHealth } from "../services/health.js";
import { sendOperatorAlert } from "../services/alerting.js";
import { consoleLogger, type Logger } from "./logger.js";

export interface HealthMonitorDeps {
  ctx: DbContext;
  redis?: RedisClient;
  registry: HealthRegistry;
  config: Config;
  senders?: Senders;
  log?: Logger;
}

interface CheckState {
  healthy: boolean;
  lastAlertAt: number;
}

/**
 * Watches the health report and alerts the operator on transitions to an
 * unhealthy state (DB down, or a critical worker gone stale). It re-alerts a
 * sustained outage no more than once per ALERT_COOLDOWN_SEC, and sends a single
 * recovery notice when a component comes back. Fires nothing while healthy.
 */
export function startHealthMonitor(deps: HealthMonitorDeps, intervalMs: number): () => void {
  const log = deps.log ?? consoleLogger;
  const { config } = deps;
  deps.registry.register("health-monitor");
  const cooldownMs = config.ALERT_COOLDOWN_SEC * 1000;
  // Suppress alerts during startup so a normal boot (workers not yet run) is
  // silent; a component still down after the grace window alerts as usual.
  const bootAt = Date.now();
  const graceMs = Math.max(90_000, intervalMs * 2);
  // Start optimistic so a healthy boot is silent; the first real failure alerts.
  const state = new Map<string, CheckState>();

  const evaluate = (key: string, healthy: boolean, message: string, now: number) => {
    const inGrace = now - bootAt < graceMs;
    const prev = state.get(key) ?? { healthy: true, lastAlertAt: 0 };
    if (!healthy) {
      // Track the unhealthy state during grace, but don't page yet.
      const firstTrip = prev.healthy;
      const cooledDown = now - prev.lastAlertAt >= cooldownMs;
      if (!inGrace && (firstTrip || cooledDown)) {
        void sendOperatorAlert(config, deps.senders, `DOWN: ${key}`, message, log);
        state.set(key, { healthy: false, lastAlertAt: now });
      } else {
        state.set(key, { healthy: false, lastAlertAt: prev.lastAlertAt });
      }
    } else {
      if (!prev.healthy && !inGrace) {
        void sendOperatorAlert(config, deps.senders, `RECOVERED: ${key}`, message, log);
      }
      state.set(key, { healthy: true, lastAlertAt: 0 });
    }
  };

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    deps.registry.markStart("health-monitor");
    try {
      const report = await readHealth(deps.ctx, deps.redis, deps.registry, config);
      const now = Date.now();

      evaluate(
        "database",
        report.dependencies.database.ok,
        report.dependencies.database.detail ?? "Postgres is unreachable.",
        now,
      );

      const poller = report.workers.find((w) => w.name === "open511-poller");
      if (poller) {
        evaluate(
          "open511-freshness",
          poller.ok,
          `No successful Open511 poll in ${poller.ageSec ?? "∞"}s (threshold ${config.OPEN511_STALE_ALERT_SEC}s). ${poller.lastError ?? ""}`.trim(),
          now,
        );
      }

      for (const w of report.workers) {
        if (w.name === "open511-poller") continue; // handled above
        evaluate(`worker:${w.name}`, w.ok, `${w.name} unhealthy — last error: ${w.lastError ?? "stale"}.`, now);
      }

      deps.registry.markSuccess("health-monitor", report.ok ? "all healthy" : "degraded");
    } catch (err) {
      log.error("health-monitor: check failed", err);
      deps.registry.markError("health-monitor", err);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
