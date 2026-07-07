# Spakwus — Operator Runbook

A product of **Nisse Group Ltd**. This is the single-operator guide to deploying
and running Spakwus (Sea to Sky / Hwy 99 conditions hub). Software only.

Two supported topologies — pick one:

| Path | Backend (`@nissegroup/core`) | Hub (`@nissegroup/hub`) | Best for |
| --- | --- | --- | --- |
| **A. Managed** | Fly.io + managed Postgres + Upstash Redis | Netlify / Cloudflare Pages (static + CDN) | least ops, global CDN |
| **B. Single VPS** | Docker Compose (Postgres + Redis + core) | Caddy static + CDN-style fallback | one box, full control |

Both keep the mandatory property: **if the backend is down, the hub still shows
the last confirmed status** from a CDN-hosted `status-fallback.json`, behind a
"service degraded — last confirmed at &lt;time&gt;" banner.

---

## 0. Prerequisites

- Node 20 + `pnpm@9` (`corepack enable`).
- A domain (e.g. `spakwus.ca`) and an API host/subdomain (e.g. `spakwus-core.fly.dev`).
- For Path A: `flyctl`. For Path B: Docker + Docker Compose on the VPS.

Generate the secrets you'll need once:

```bash
# Web push VAPID keys
npx -y web-push generate-vapid-keys
# A steward token (moderation login) and any other tokens
openssl rand -hex 24
```

---

## Path A — Fly.io + CDN

### A1. Provision data stores
```bash
fly launch --no-deploy                 # from repo root; uses ./fly.toml (app: spakwus-core)
fly postgres create --name spakwus-db  # or use Supabase/Neon and set DATABASE_URL
fly postgres attach spakwus-db         # sets DATABASE_URL secret
# Redis: create an Upstash DB (fly ext redis create) and note its URL.
fly redis create
```

> Postgres must have **PostGIS**. Fly Postgres images include it; the app runs
> `CREATE EXTENSION postgis` in migration `0000`. On a managed provider, ensure
> the PostGIS extension is allowed.

### A2. Set secrets
```bash
fly secrets set \
  REDIS_URL="redis://…upstash…" \
  STEWARD_TOKENS="<steward-token>" \
  PUBLIC_BASE_URL="https://spakwus.ca" \
  SNAPSHOT_HTTP_URL="https://spakwus.ca/status-fallback.json" \
  SNAPSHOT_HTTP_TOKEN="<cdn-upload-token>" \
  ANTHROPIC_API_KEY="…"            # optional (LLM note classification)
# Notifications (optional):
fly secrets set VAPID_PUBLIC_KEY="…" VAPID_PRIVATE_KEY="…" RESEND_API_KEY="…" \
  TELEGRAM_BOT_TOKEN="…" TELEGRAM_CHANNEL_ID="@spakwus"
# Operator alerts (optional, pick any):
fly secrets set OPERATOR_WEBHOOK_URL="https://hooks.slack.com/…"
```

`DATABASE_URL` is set by `fly postgres attach`. Migrations run automatically on
boot (`migrate()` in `index.ts`).

### A3. Deploy
```bash
fly deploy               # builds packages/core/Dockerfile from the workspace root
fly logs                 # watch startup: migrations, "channels available", workers
curl https://spakwus-core.fly.dev/health          # {"ok":true,...}
curl https://spakwus-core.fly.dev/api/health      # freshness + worker report
```

### A4. Deploy the hub (Netlify or Cloudflare Pages)
- Connect the repo. Build settings come from `packages/hub/netlify.toml`.
- Set env in the dashboard (or netlify.toml):
  - `VITE_API_BASE=https://spakwus-core.fly.dev/api`
  - `VITE_STATIC_FALLBACK_URL=/status-fallback.json`
- The **static fallback** is served from the hub's own domain at
  `/status-fallback.json`. The backend keeps it current via `SNAPSHOT_PUBLISH=http`
  PUTting to `SNAPSHOT_HTTP_URL`. Wire that URL to a writable object at your CDN:
  - **Cloudflare**: an R2 bucket + a small Worker that accepts an authenticated
    `PUT /status-fallback.json` (checks `Authorization: Bearer SNAPSHOT_HTTP_TOKEN`)
    and serves it at the site path. (Or use R2's S3 API with a pre-signed URL.)
  - **Netlify**: use a Netlify Blob / function endpoint that stores + serves the
    file, or run Path B where Caddy serves it from a shared volume.
- If you can't wire an HTTP upload, set `SNAPSHOT_PUBLISH=file` + a Fly volume
  (see `fly.toml` `[mounts]`) and put a tiny CDN/edge cache in front of
  `GET /api/status/snapshot` instead — but note that path dies with the backend,
  so the HTTP-to-CDN publish is preferred for true independence.

---

## Path B — Single VPS (Docker Compose, all-in-one)

Everything (Postgres, Redis, core, and Caddy serving the hub + fallback) on one box.

```bash
git clone <repo> && cd Spakwus
pnpm install --frozen-lockfile
pnpm build:shared && pnpm --filter @nissegroup/hub build   # produces packages/hub/dist

cp infra/.env.prod.example infra/.env.prod
$EDITOR infra/.env.prod          # set SPAKWUS_DOMAIN, POSTGRES_PASSWORD, STEWARD_TOKENS, …

docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
```

- Point your domain's A/AAAA records at the VPS; Caddy provisions TLS automatically.
- Core writes `status-fallback.json` to a shared volume; **Caddy serves it at
  `/status-fallback.json`** independently of core, so a core crash still leaves a
  readable last-known status.
- The hub is built with same-origin `/api` (no `VITE_API_BASE` needed) since Caddy
  proxies `/api` → core on the same domain.

Verify:
```bash
curl https://$SPAKWUS_DOMAIN/health
curl https://$SPAKWUS_DOMAIN/api/health
curl https://$SPAKWUS_DOMAIN/status-fallback.json     # last-known status JSON
```

---

## 1. Backfill historical stats (both paths)

The `/history` view is empty until you load DriveBC historical event CSVs. Get
the exports from the DriveBC / BC open-data portal (highway events / road events
historical dataset), then:

```bash
# From a checkout that can reach DATABASE_URL:
DATABASE_URL="postgres://…" pnpm --filter @nissegroup/core run load:history -- ./drivebc-events-2023.csv ./drivebc-events-2024.csv
# Preview first without writing:
DATABASE_URL="postgres://…" pnpm --filter @nissegroup/core run load:history -- --dry-run ./events.csv
```

The loader is tolerant of column-name variation, filters to the Hwy 99 corridor
(by road name or coordinates), classifies closures, assigns the nearest segment,
and upserts idempotently by event id — safe to re-run. Re-run whenever DriveBC
publishes new history.

---

## 2. Health, freshness & alerts

- **Public status page**: `https://<hub>/health` (and JSON at `GET /api/health`).
  Shows Open511 freshness (last successful poll), each worker's health, and DB +
  Redis reachability. Returns HTTP **503** when unhealthy — point an external
  uptime monitor (UptimeRobot, Better Stack, Fly checks) at `/api/health`.
- **Operator alerts**: the `health-monitor` worker alerts when Postgres is
  unreachable or a critical worker (esp. the Open511 poller) goes stale beyond
  `OPEN511_STALE_ALERT_SEC` (default 10 min). It alerts on the transition, again
  no more than once per `ALERT_COOLDOWN_SEC` (default 30 min), and sends a
  recovery notice. Sinks (any subset): `OPERATOR_WEBHOOK_URL` (Slack/Discord),
  `OPERATOR_EMAIL` (needs Resend), `OPERATOR_TELEGRAM_CHAT_ID`.
- **Logs**: structured JSON (pino) at `LOG_LEVEL`. `fly logs`, or
  `docker compose -f infra/docker-compose.prod.yml logs -f core`.

---

## 3. Routine operations

| Task | Path A (Fly) | Path B (VPS) |
| --- | --- | --- |
| Tail logs | `fly logs` | `docker compose … logs -f core` |
| Restart core | `fly apps restart spakwus-core` | `docker compose … restart core` |
| Redeploy backend | `fly deploy` | `docker compose … up -d --build core` |
| Redeploy hub | push to Git (CDN auto-build) | `pnpm --filter @nissegroup/hub build && docker compose … restart caddy` |
| DB shell | `fly postgres connect -a spakwus-db` | `docker compose … exec postgres psql -U spakwus` |
| Backup DB | `fly postgres … pg_dump` | `docker compose … exec postgres pg_dump -U spakwus spakwus > backup.sql` |

**Migrations** are applied automatically at startup and tracked in `_migrations`;
deploying a new version with new SQL in `packages/core/drizzle/` is all that's
needed. **Rollback**: `fly releases` + `fly deploy --image <prev>` (Path A), or
`docker compose … up -d` on the previous git tag (Path B). Migrations are
forward-only — restore from a `pg_dump` if a rollback needs schema reversal.

---

## 4. Config reference

All backend config is env-driven and validated at boot (`packages/core/src/config.ts`).
See `packages/core/.env.example` for the full annotated list. The hardening knobs:

| Var | Default | Purpose |
| --- | --- | --- |
| `STATUS_CACHE_TTL_SEC` | `10` | Redis TTL for `/api/status[/snapshot]`; busted on every write |
| `SNAPSHOT_PUBLISH` | `file` | `file` \| `http` \| `none` — where the fallback is written |
| `SNAPSHOT_FILE` | `./public/status-fallback.json` | file-backend output path |
| `SNAPSHOT_HTTP_URL` / `_TOKEN` | — | authenticated PUT target for the CDN fallback |
| `SNAPSHOT_PUBLISH_MS` | `20000` | fallback refresh interval (republishes only on change) |
| `OPEN511_STALE_ALERT_SEC` | `600` | poller staleness that trips a freshness alert |
| `ALERT_COOLDOWN_SEC` | `1800` | minimum gap between repeat operator alerts |
| `LOG_LEVEL` | `info` | pino level |

---

© Nisse Group Ltd. Support: support@nissegroup.example
