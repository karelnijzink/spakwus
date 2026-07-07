// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { DbContext } from "../db/client.js";
import { expireRequests } from "../services/community.js";
import type { HealthRegistry } from "../services/health.js";
import { consoleLogger, type Logger } from "./logger.js";

export interface RequestExpirerDeps {
  ctx: DbContext;
  log?: Logger;
  health?: HealthRegistry;
}

/**
 * Self-cleaning: expire community requests whose TTL has passed or whose linked
 * incident has cleared, so the board never accumulates stale posts.
 */
export function startRequestExpirer(deps: RequestExpirerDeps, intervalMs: number): () => void {
  const log = deps.log ?? consoleLogger;
  const health = deps.health;
  health?.register("request-expirer");
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    health?.markStart("request-expirer");
    try {
      const expired = await expireRequests(deps.ctx);
      if (expired > 0) log.info(`request-expirer: expired ${expired} request(s)`);
      health?.markSuccess("request-expirer", `expired=${expired}`);
    } catch (err) {
      log.error("request-expirer: failed", err);
      health?.markError("request-expirer", err);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
