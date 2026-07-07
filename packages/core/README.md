# @nissegroup/core

The Spakwus backend — the **conditions / control plane**. A product of
Nisse Group Ltd. Software only (no hardware, mesh, LoRa, or MQTT).

**Stack:** Fastify · Drizzle ORM · Postgres 16 + PostGIS · Redis · Zod, on
Node 20. Status is derived by the pure, deterministic `deriveStatus` from
[`@nissegroup/shared`](../shared) — the backend never lets the LLM (or the
community board) influence status.

## Architecture

```
                 ┌────────────────────────────────────────────┐
  Open511 ──poll─▶│ open511-poller ─▶ reports (source=open511) │
                 │ webcam-fetcher ─▶ webcams (capture times)   │
  reports ──────▶│                     │                       │
                 │                     ▼                       │
                 │  reconciler: match reports→incidents,       │
                 │  deriveStatus() ─▶ segment_status           │
                 │                     │  (+status_changes audit)
                 └─────────────────────┼───────────────────────┘
                                       ▼
                          Read API (Fastify, JSON)
```

- **open511-poller** — every 60s, fetches
  `https://api.open511.gov.bc.ca/events?format=json` (following pagination and
  filtering to the Highway 99 bbox + `ACTIVE` status), normalizes each event to a
  `report` with `source='open511'` on the nearest segment, upserts idempotently
  by `external_id`, archives dropped events, and caches the raw response in Redis.
- **webcam-fetcher** — refreshes the open DriveBC Hwy 99 webcam image URLs on a
  schedule, recording a capture timestamp (HTTP `Last-Modified` when available).
- **reconciler** — on any new report/poll, matches reports to incidents (same
  segment + type + proximity + time window), calls `deriveStatus`, writes
  `segment_status`, and appends a `status_changes` row on every flip. Includes an
  **LLM hook** ([`services/llm.ts`](src/services/llm.ts)) that turns `raw_text`
  into structured fields + a one-line summary. This runs *before* derivation;
  `deriveStatus` stays deterministic and never calls the LLM.

### Open511 events vs. the shared state machine

Open511 events are stored as `reports` (with `source='open511'`), but
`deriveStatus` distinguishes official events from community reports. The bridge
lives in [`domain/mapping.ts`](src/domain/mapping.ts): `open511` rows become
`OfficialEvent`s (authoritative, not subject to the 45-minute corroboration
window); everything else becomes community/steward `Report`s. Steward overrides
are empty in this phase (no override table yet), and — per rule 8 — no
`CommunityRequest` data is ever passed in.

## Data model (Drizzle + PostGIS)

Tables: `segments` (seeded, `LineString` geometry), `incidents`, `reports`
(`Point` geometry), `segment_status`, `webcams`, and `status_changes` (the audit
trail: `from_state`, `to_state`, `cause`, `actor`, `reason`, `created_at`).

[`src/db/schema.ts`](src/db/schema.ts) is the source of truth for queries and
types. The **authoritative migrations are the hand-written SQL files in
[`drizzle/`](drizzle)** — they own the PostGIS extension, geometry columns, GiST
indexes, and the segment/webcam seed data (which Drizzle-kit's generic
generation does not express well). They are applied in order by
[`src/db/migrate.ts`](src/db/migrate.ts), tracked in a `_migrations` table.

## Read API

All responses are JSON and carry provenance — `source`, a timestamp, and (where
meaningful) `confidence`.

| Endpoint | Description |
| --- | --- |
| `GET /api/status` | Corridor + per-segment status |
| `GET /api/incidents?active=1` | Incidents with their reports |
| `GET /api/webcams` | DriveBC webcams with capture times |
| `GET /api/status/snapshot` | One compact object the PWA caches offline |
| `GET /api/history/stats` | Historical corridor stats (closures/month, worst segments, durations) |
| `GET /health` | Liveness + brand identity |
| `GET /api/health` | Freshness + worker + dependency health (503 when unhealthy) |

`/api/status` and `/api/status/snapshot` are served through a **short-TTL Redis
cache** (`STATUS_CACHE_TTL_SEC`, default 10s) that is busted immediately on every
write, so a flip shows up at once. The cache **fails open** — a Redis outage (or
a slow Redis) can never stall the read path.

## Public reporting, moderation & overrides (STATUS plane)

- **`POST /api/reports`** — a public report with a canned incident type (crash /
  hazard / debris / stopped-traffic / weather / wildlife), a segment or map-pin
  location, an optional note and contact. Stored as `source='web'`,
  `trust_level='anon'` (or `known`/`steward` by device token), and fed through
  the reconciler like any other report. **Rate-limited by IP + device token via
  Redis.** A single anon report can never flip the banner — enforced in
  `deriveStatus` (a lone unverified report of any kind stays OPEN with a
  "reported, unconfirmed" incident); corroboration or a steward is required, and
  anon reports are clamped to the partial family (never a full closure).
- **LLM enrichment** ([`services/llm.ts`](src/services/llm.ts)) classifies the
  note into `{kind, severity, summary}` via the Anthropic Messages API (forced
  tool call, `ANTHROPIC_MODEL`, default `claude-opus-4-8`), falling back to a
  deterministic keyword stub when `ANTHROPIC_API_KEY` is unset or a call fails.
  **`deriveStatus` never calls the LLM.**
- **Admin API** (steward bearer token via `STEWARD_TOKENS`): `GET
  /api/admin/reports?state=`, `POST /api/admin/reports/:id/verify` (the steward
  vouches → the report can now flip status), `.../dismiss`, `POST
  /api/admin/reports/merge`, `GET|POST /api/admin/overrides`, `DELETE
  /api/admin/overrides/:id`, `GET /api/admin/audit`.
- **Manual overrides** win over everything (deriveStatus rule 6) and their
  **required reason is shown publicly** on the affected segment (surfaced in
  `/api/status` and `/api/status/snapshot`). Every admin action writes an
  `audit_log` row, and every status flip writes a `status_changes` row.

## Community plane (strictly separate from status)

The community board lets people post needs/offers during a closure. **None of it
is ever read by `deriveStatus`** — community requests can never change any status.
The only thing the status surface exposes is a **count** (`requestCount` on the
incidents list, and `GET /api/incidents/:id/request-count`) — never request text.

- **`community_requests`** (`services/community.ts`, [`0004_community.sql`](drizzle/0004_community.sql)):
  `kind` (need/offer/info), `category` (welfare/supplies/ride/shelter/eyes_on/other),
  segment, auto-linked `incident_id` (the active incident on that segment at
  creation), optional geometry + `location_desc`, short `body`, `contact_method`
  (in_app/phone/none), `status` (open/matched/resolved/expired), anon
  `created_by`, `expires_at`; `request_responses` for a light thread.
- Endpoints: `POST /api/requests` (rate-limited, auto-links incident, sets TTL),
  `POST /api/requests/:id/responses`, `PATCH /api/requests/:id` (requester marks
  matched/resolved), `GET /api/requests?incidentId=|segmentId=|bbox=` (open,
  non-expired, newest first), plus public `POST .../flag` on requests/responses.
- **Self-cleaning** ([`workers/request-expirer.ts`](src/workers/request-expirer.ts)):
  expires requests when their linked incident clears or `expires_at` passes
  (default 8h, capped 24h), so the board never accumulates stale posts.
- **Optional bridge** (`POST /api/requests/:id/escalate`): a deliberate, explicit
  action turning an "info" request into a real status-plane report that then
  flows through the normal reconciler (subject to all the usual rules). Never
  automatic.
- **Moderation** reuses the Phase 3 posture: stewards remove via
  `POST /api/admin/requests/:id/remove` / `.../responses/:id/remove` (audited);
  the public can flag (auto-hides at a threshold). Categories, rate limits, and
  auto-expiry keep the board far lighter than open comment threads.

## Notifications

Warns people while they still have signal in town. **Alerts fire ONLY off
`status_changes` rows from the deterministic engine** — never off a single
unconfirmed report, never off community requests — when a segment flips to
PARTIAL/CLOSED or clears.

- **Channels** ([`services/notifications/channels.ts`](src/services/notifications/channels.ts)):
  web push (VAPID) + email (Resend, double opt-in) as core; Telegram (posts every
  alert to a public channel + DMs subscribers) as an included option; SMS (Twilio)
  behind `ENABLE_SMS`, off by default. Unconfigured channels simply aren't offered
  (`GET /api/notifications/config` reports what's available); email logs in dev.
- **Subscription model** (`notification_subscriptions`, stored as the shared
  `NotificationSubscription`): whole corridor or a segment, optional direction, no
  account for web push/Telegram, double opt-in for email. `POST
  /api/notifications/subscribe`, `GET .../verify?token=`, `POST .../unsubscribe`.
- **Fan-out** ([`fanout.ts`](src/services/notifications/fanout.ts), run by
  [`workers/notifier.ts`](src/workers/notifier.ts)): builds actionable, located,
  timestamped copy ("Highway 99 CLOSED — <segment>, both directions, as of <time>.
  … If you have not left <town> yet, wait. Source: <official/corroborated>."),
  **de-duplicates per subscriber per flip** (unique `notification_deliveries` row),
  and applies **quiet hours to non-closure severities only — a full closure always
  sends**.
- **Optional, separate stream**: a requester can opt in (via `notify_channel` /
  `notify_target` on their request) to be alerted when someone responds — kept out
  of the status alert fan-out entirely.

## Hardening & operations

- **Static fallback (fail to stale-but-honest).** The `snapshot-publisher` worker
  regenerates the last-known corridor status and publishes it to a CDN-hosted
  `status-fallback.json` on every status change (`services/publisher.ts`, backends:
  `file`, `http`, `none` via `SNAPSHOT_PUBLISH`). The hub fetches it when the API
  is unreachable and shows a **"service degraded — last confirmed at &lt;time&gt;"**
  banner. Because it lives on the hub's own CDN, it survives a total backend outage.
- **Health + freshness** (`services/health.ts`). `GET /api/health` exposes Open511
  freshness (last successful poll + age), every worker's health, and live DB +
  Redis probes; it returns **503** when unhealthy so external uptime monitors can
  key off it. Surfaced publicly at `/health` in the hub.
- **Historical stats** (`services/history.ts`, migration `0006`, loader
  `scripts/load-history.ts`). Backfill DriveBC historical event CSVs
  (`pnpm run load:history -- events.csv`) — the loader is column-tolerant, filters
  to the Hwy 99 corridor, classifies closures, assigns the nearest segment, and
  upserts idempotently. `GET /api/history/stats` serves closures/month, worst
  segments, and typical durations. This view **never** feeds `deriveStatus`.
- **Observability.** Structured JSON logs (pino) at `LOG_LEVEL`. The
  `health-monitor` worker (`services/alerting.ts`) pages the operator on DB outage
  or worker staleness (esp. the Open511 poller past `OPEN511_STALE_ALERT_SEC`),
  with a startup grace window, a re-alert cooldown, and recovery notices. Sinks:
  `OPERATOR_WEBHOOK_URL` (Slack/Discord), `OPERATOR_EMAIL`, `OPERATOR_TELEGRAM_CHAT_ID`.

### Deployment

Container + IaC + a single-operator runbook live in [`infra/`](../../infra/RUNBOOK.md):
a multi-stage [`Dockerfile`](Dockerfile), a root [`fly.toml`](../../fly.toml) for
Fly.io, an all-in-one [`docker-compose.prod.yml`](../../infra/docker-compose.prod.yml)
+ Caddy for a single VPS, and hub static/CDN config
([`netlify.toml`](../../packages/hub/netlify.toml)). Migrations apply automatically
at boot. See the runbook for first-time setup, secrets, and routine ops.

## Running locally

```bash
# 1. Start Postgres 16 + PostGIS and Redis
docker compose up -d postgres redis

# 2. Configure env
cp .env.example .env

# 3. Apply migrations (creates PostGIS schema + seeds the three segments)
pnpm --filter @nissegroup/core run migrate

# 4. Run the API + workers (watch mode)
pnpm dev:core         # from the repo root
```

## Testing

Unit tests (Open511 normalization) run anywhere. The **integration tests** run
against a real Postgres + PostGIS given by `TEST_DATABASE_URL`; when it is unset
they are skipped.

```bash
docker compose up -d postgres-test
TEST_DATABASE_URL=postgres://spakwus:spakwus@localhost:5433/spakwus_test \
  pnpm --filter @nissegroup/core run test
```

The integration suites cover the reconciler (corroboration, flips + audit,
incident grouping, clears), the Open511 poller (pagination, segment assignment,
idempotent upsert, archive→reopen), and the read API (response shapes +
provenance).

---

© Nisse Group Ltd.
