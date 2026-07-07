// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { DbContext } from "../db/client.js";
import type { Config } from "../config.js";
import { fanOutPending } from "../services/notifications/fanout.js";
import type { Senders } from "../services/notifications/channels.js";
import type { HealthRegistry } from "../services/health.js";
import { consoleLogger, type Logger } from "./logger.js";

export interface NotifierDeps {
  ctx: DbContext;
  senders: Senders;
  config: Config;
  log?: Logger;
  health?: HealthRegistry;
}

/** Poll for unnotified status_changes and fan out alerts. Returns a stop fn. */
export function startNotifier(deps: NotifierDeps, intervalMs: number): () => void {
  const log = deps.log ?? consoleLogger;
  const health = deps.health;
  health?.register("notifier");
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    health?.markStart("notifier");
    try {
      const { processed, sent } = await fanOutPending({ ctx: deps.ctx, senders: deps.senders, config: deps.config, log });
      if (sent > 0) log.info(`notifier: sent ${sent} alert(s)`);
      health?.markSuccess("notifier", `processed=${processed} sent=${sent}`);
    } catch (err) {
      log.error("notifier: fan-out failed", err);
      health?.markError("notifier", err);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
