// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { z } from "zod";

/**
 * Runtime configuration, validated with Zod. Reads from process.env; callers
 * that want a .env file should load one (e.g. `import "dotenv/config"`) before
 * calling `loadConfig`.
 */
const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1).default("postgres://spakwus:spakwus@localhost:5432/spakwus"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  ENABLE_WORKERS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  OPEN511_URL: z.string().url().default("https://api.open511.gov.bc.ca/events"),
  OPEN511_POLL_MS: z.coerce.number().int().positive().default(60_000),
  WEBCAM_REFRESH_MS: z.coerce.number().int().positive().default(120_000),

  // Steward auth: comma-separated bearer tokens that grant the steward role for
  // the admin/moderation API. A device token matching one of these also makes a
  // web report count as a steward report.
  STEWARD_TOKENS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((t) => t.trim()).filter(Boolean)),

  // Public report rate limits (per rolling window).
  REPORT_RATE_WINDOW_SEC: z.coerce.number().int().positive().default(600),
  REPORT_RATE_MAX_IP: z.coerce.number().int().positive().default(10),
  REPORT_RATE_MAX_TOKEN: z.coerce.number().int().positive().default(5),

  // LLM classification (services/llm.ts). When ANTHROPIC_API_KEY is unset, the
  // deterministic keyword stub is used instead.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-4-8"),

  // Public base URL used in notification deep links.
  PUBLIC_BASE_URL: z.string().default("http://localhost:5173"),
  NOTIFY_POLL_MS: z.coerce.number().int().positive().default(10_000),

  // --- Observability / logging ---
  // pino level for the API + workers. JSON structured logs at info by default.
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // --- Read cache (short-TTL Redis cache for the hot read endpoints) ---
  // Cache /api/status and /api/status/snapshot for this many seconds. Reconcile
  // busts the cache immediately, so this only bounds staleness if a write is
  // missed. 0 disables the cache (always read-through).
  STATUS_CACHE_TTL_SEC: z.coerce.number().int().min(0).default(10),

  // --- Static fallback snapshot publishing ---
  // The last-known corridor status is written here on every status change so the
  // hub can fail to a stale-but-honest state when the backend is unreachable.
  // "file" writes SNAPSHOT_FILE; "http" also PUTs to SNAPSHOT_HTTP_URL (CDN
  // origin / object store); "none" disables publishing.
  SNAPSHOT_PUBLISH: z.enum(["file", "http", "none"]).default("file"),
  SNAPSHOT_FILE: z.string().default("./public/status-fallback.json"),
  SNAPSHOT_PUBLISH_MS: z.coerce.number().int().positive().default(20_000),
  // Authenticated PUT target for the CDN-hosted fallback (e.g. a Cloudflare
  // Worker / R2 / S3 pre-signed endpoint). Bearer token is optional.
  SNAPSHOT_HTTP_URL: z.string().optional(),
  SNAPSHOT_HTTP_TOKEN: z.string().optional(),

  // --- Operator uptime alerting ---
  // A worker is considered stale (and alertable) when it has not succeeded in
  // this many seconds. The Open511 poller is the critical freshness source.
  OPEN511_STALE_ALERT_SEC: z.coerce.number().int().positive().default(600),
  HEALTH_MONITOR_MS: z.coerce.number().int().positive().default(60_000),
  // Re-alert cooldown so a sustained outage does not spam the operator.
  ALERT_COOLDOWN_SEC: z.coerce.number().int().positive().default(1800),
  // Alert sinks (any subset). Generic webhook posts { text } (Slack/Discord/etc).
  OPERATOR_WEBHOOK_URL: z.string().optional(),
  OPERATOR_EMAIL: z.string().optional(),
  OPERATOR_TELEGRAM_CHAT_ID: z.string().optional(),
  // Quiet hours (local 24h) — apply to non-closure alerts only.
  QUIET_HOURS_START: z.coerce.number().int().min(0).max(23).default(22),
  QUIET_HOURS_END: z.coerce.number().int().min(0).max(23).default(7),

  // --- Notification channels ---
  // Web push (VAPID). Generate with `npx web-push generate-vapid-keys`.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:support@nissegroup.com"),
  // Email — Resend API, or SMTP is left as an ops choice. Double opt-in either way.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Spakwus <alerts@nissegroup.com>"),
  // Telegram bot: posts every alert to a public channel, DMs subscribers.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  // SMS (Twilio) — OFF by default, behind a flag.
  ENABLE_SMS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse(env);
}

/**
 * The Sea to Sky corridor bounding box (BC Highway 99), as
 * [west, south, east, north] in WGS84. Used to filter Open511 events to the
 * corridor before segment assignment.
 */
export const HWY99_BBOX = {
  west: -123.35,
  south: 49.3,
  east: -122.6,
  north: 50.4,
} as const;
