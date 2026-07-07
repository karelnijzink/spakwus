// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { defineConfig } from "drizzle-kit";

/**
 * Drizzle-kit config. `src/db/schema.ts` is the source of truth for queries and
 * types. The authoritative migrations, however, are the hand-written SQL files
 * in `drizzle/` (they manage the PostGIS extension, geometry columns, GiST
 * indexes, and seed data). Use this config for `drizzle-kit studio` / typegen.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://spakwus:spakwus@localhost:5432/spakwus",
  },
});
