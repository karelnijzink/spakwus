// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

/**
 * Spakwus backend entrypoint (Node 20 + Fastify).
 *
 * Wires the two planes together: the conditions/control plane (Open511 poller,
 * webcam fetcher, reconciler over the deterministic `deriveStatus`) and the
 * read API. See the README for the two-plane design.
 */

import "dotenv/config";
import { loadConfig } from "./config.js";
import { createDbContext } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { createRedis } from "./redis/client.js";
import { buildServer } from "./api/server.js";
import { reconcile } from "./services/reconciler.js";
import { createLlmExtractor } from "./services/llm.js";
import { createSenders } from "./services/notifications/channels.js";
import { HealthRegistry } from "./services/health.js";
import { startOpen511Poller } from "./workers/open511-poller.js";
import { startWebcamFetcher } from "./workers/webcam-fetcher.js";
import { startRequestExpirer } from "./workers/request-expirer.js";
import { startNotifier } from "./workers/notifier.js";
import { startSnapshotPublisher } from "./workers/snapshot-publisher.js";
import { startHealthMonitor } from "./workers/health-monitor.js";

async function main() {
  const config = loadConfig();
  const ctx = createDbContext(config.DATABASE_URL);

  await migrate(ctx.sql);
  // Ensure segment_status rows exist before serving reads.
  await reconcile(ctx, { cause: "startup", actor: "system" });

  // Redis is used for rate limiting + known-token tracking (always on), and by
  // the workers when enabled. The LLM extractor is real when a key is set,
  // else a deterministic stub.
  const redis = createRedis(config.REDIS_URL);
  const llm = createLlmExtractor({ apiKey: config.ANTHROPIC_API_KEY, model: config.ANTHROPIC_MODEL });
  const senders = createSenders(config);
  const health = new HealthRegistry();

  const app = buildServer({
    ctx,
    config,
    redis,
    llm,
    senders,
    health,
    // Structured JSON logs (pino) at the configured level for the API + workers.
    logger: { level: config.LOG_LEVEL },
  });
  app.log.info(`notifications: channels available = [${[...senders.available].join(", ") || "none"}]`);

  const stoppers: Array<() => void> = [];

  if (config.ENABLE_WORKERS) {
    stoppers.push(startNotifier({ ctx, senders, config, log: app.log, health }, config.NOTIFY_POLL_MS));
    stoppers.push(
      startOpen511Poller(
        { ctx, redis, open511Url: config.OPEN511_URL, log: app.log, health },
        config.OPEN511_POLL_MS,
      ),
    );
    stoppers.push(
      startWebcamFetcher({ ctx, redis, log: app.log, health }, config.WEBCAM_REFRESH_MS),
    );
    // Self-cleaning community board: expire stale/cleared requests every 5 min.
    stoppers.push(startRequestExpirer({ ctx, log: app.log, health }, 5 * 60_000));
    // Keep the CDN static fallback current (fail-to-stale-but-honest).
    stoppers.push(startSnapshotPublisher({ ctx, config, log: app.log, health }, config.SNAPSHOT_PUBLISH_MS));
    // Operator uptime alerting on worker staleness / DB outage.
    stoppers.push(
      startHealthMonitor({ ctx, redis, registry: health, config, senders, log: app.log }, config.HEALTH_MONITOR_MS),
    );
  }

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down`);
    for (const stop of stoppers) stop();
    await app.close();
    redis.disconnect();
    await ctx.sql.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
