# Spakwus

**Sea to Sky Highway (BC Highway 99) live conditions hub and community board.**

Spakwus is a **product of Nisse Group Ltd**. It gives travellers on the Sea to
Sky corridor a trustworthy, at-a-glance view of road conditions between
Horseshoe Bay and Pemberton, plus a place for the community to help each other.

> **Scope: software only.** There is no hardware, no mesh networking, no LoRa,
> and no MQTT anywhere in this project. Spakwus ingests existing data sources
> (official Open511 events, community and steward reports) and serves them over
> ordinary web APIs and a PWA.

---

## The two-plane design

Spakwus deliberately separates the product into **two isolated planes** so that
social activity can never contaminate authoritative road status.

### 1. Conditions plane (authoritative)

The trust-graded status pipeline. Its only inputs are:

- **Official events** — Open511 closures / restrictions.
- **Reports** — community and trusted *steward* observations.
- **Overrides** — manual steward decisions.

These flow into a single **pure, deterministic state machine**,
[`deriveStatus`](packages/shared/src/status.ts), which produces the corridor and
per-segment status (`OPEN` / `PARTIAL` / `CLOSED`) that the whole product reads
from. Every derived status carries its `source`, `confidence`, and `updatedAt`
so the UI can always show *why* a segment is in a given state.

### 2. Community plane (social)

The community board — `CommunityRequest` and `RequestResponse`. People post ride
shares, questions, lost-and-found, and requests for help.

**This plane can never change road status.** `CommunityRequest` data is *not* an
input to `deriveStatus`, and the separation is enforced at the type level:
`deriveStatus`'s signature does not accept requests, so a request physically
cannot reach the state machine. (Rule 8.)

```
  Official (Open511) ─┐
  Reports ────────────┤──►  deriveStatus (pure)  ──►  Corridor + Segment status
  Overrides ──────────┘

  CommunityRequest / RequestResponse  ──►  Community board only  ⛔ never status
```

---

## The status rules

`deriveStatus(reports, officialEvents, overrides, now)` implements:

1. **Default `OPEN`.**
2. **`CLOSED`** only if (a) an official Open511 closure on the segment, **or**
   (b) two or more *independent* corroborating reports within a 45-minute
   window. A steward report corroborates alone.
3. A single unconfirmed **non-steward** report never sets `CLOSED`; it yields an
   incident with confidence `unconfirmed` and leaves the segment `OPEN`.
4. **`PARTIAL`** for single-lane, alternating, and delay states.
5. **Clearing** requires an official clear, a steward clear, or a timeout with
   no active corroborated incident.
6. A manual **steward override always wins** and records its reason.
7. Every returned status carries `source`, `confidence`, and `updatedAt`.
8. Community-board data is **not** an input and can never change status
   (enforced at the type level).

The function is pure and deterministic — output depends only on its arguments
(including `now`) — and is fully covered by
[vitest](packages/shared/test/status.test.ts).

### Corridor segments

| id                        | Segment                     |
| ------------------------- | --------------------------- |
| `horseshoe-bay-squamish`  | Horseshoe Bay to Squamish   |
| `squamish-whistler`       | Squamish to Whistler        |
| `whistler-pemberton`      | Whistler to Pemberton       |

---

## Monorepo layout

A [pnpm](https://pnpm.io) workspace under the npm org scope **`@nissegroup`**.

| Package                | Path               | What it is                                                                 |
| ---------------------- | ------------------ | -------------------------------------------------------------------------- |
| `@nissegroup/shared`   | `packages/shared`  | TypeScript types, the pure deterministic status state machine, brand config. |
| `@nissegroup/core`     | `packages/core`    | Node 20 backend — Fastify + Drizzle/Postgres+PostGIS + Redis + Zod; the conditions/control plane (Open511 poller, webcam fetcher, reconciler, read API). See [its README](packages/core/README.md). |
| `@nissegroup/hub`      | `packages/hub`     | React + Vite + TypeScript + Tailwind + MapLibre PWA — the public read plane (status, map, incidents, offline snapshot). See [its README](packages/hub/README.md). |

`core` and `hub` both depend on `shared` via `workspace:*`.

### Branding

All user-facing strings, colours, and the theme colour come from a single brand
config module, [`packages/shared/src/brand.ts`](packages/shared/src/brand.ts):
`productName` (“Spakwus”), `publisher` (“Nisse Group Ltd”), `publisherUrl`,
`supportEmail`, plus `logoPath` and `colors` (primary / secondary / theme).

> ⚠️ **The colour and logo values are clearly-marked `TODO` placeholders.**
> Replace them in `brand.ts` (and the mirrored CSS variables in
> `packages/hub/src/index.css`, the static `theme-color` in `index.html`, and
> `packages/hub/public/manifest.webmanifest`) once the visual identity is set.

Source files carry an SPDX-style header: `Copyright Nisse Group Ltd`.

---

## Getting started

Requires **Node 20+** and **pnpm 9+** (`corepack enable` will provide pnpm).

```bash
pnpm install          # install all workspace dependencies
pnpm build            # build every package (shared first)
pnpm test             # run all tests (the state-machine vitest suite lives in shared)
```

### Per-package scripts (from the repo root)

```bash
pnpm build:shared     # build @nissegroup/shared
pnpm test:shared      # run the deriveStatus vitest suite
pnpm build:core       # build @nissegroup/core
pnpm dev:core         # run the Fastify backend in watch mode
pnpm start:core       # run the built backend
pnpm build:hub        # build @nissegroup/hub
pnpm dev:hub          # run the Vite dev server (proxies /api to core)
```

You can also target any package directly with pnpm's filter, e.g.
`pnpm --filter @nissegroup/hub run dev`.

---

## Licensing — decision required

**No licence has been chosen yet. This is left to the owner (Nisse Group Ltd).**

The repository currently declares `"license": "SEE LICENSE IN README.md"` in
each `package.json`, and source files use the placeholder SPDX identifier
`LicenseRef-TBD`. Before any public distribution, the owner should:

1. Decide on a licence — e.g. a proprietary/all-rights-reserved licence, or an
   open-source licence (MIT, Apache-2.0, AGPL-3.0, …).
2. Add a `LICENSE` file at the repo root with the chosen terms.
3. Update the `license` field in every `package.json` and replace the
   `LicenseRef-TBD` SPDX identifier in source headers accordingly.

Until then, all rights are reserved by Nisse Group Ltd.

---

© Nisse Group Ltd. Spakwus is a product of Nisse Group Ltd.
