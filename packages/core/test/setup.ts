// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { createDbContext, type DbContext } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { loadConfig, type Config } from "../src/config.js";

/** A deterministic config for tests, with a known steward token. */
export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({ STEWARD_TOKENS: "test-steward", ...overrides } as NodeJS.ProcessEnv);
}

/**
 * Integration tests run against a real Postgres 16 + PostGIS database given by
 * TEST_DATABASE_URL (see docker-compose.yml service `postgres-test`). When the
 * variable is unset the DB-backed suites are skipped so the unit tests can run
 * anywhere.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const dbAvailable = Boolean(TEST_DATABASE_URL);

export async function setupTestDb(): Promise<DbContext> {
  const ctx = createDbContext(TEST_DATABASE_URL!);
  await migrate(ctx.sql);
  return ctx;
}

/** Reset the mutable tables between tests; keep the seeded segments/webcams. */
export async function truncateMutable(ctx: DbContext): Promise<void> {
  await ctx.sql`TRUNCATE status_changes, segment_status, reports, incidents, steward_overrides, audit_log RESTART IDENTITY CASCADE`;
  await ctx.sql`UPDATE webcams SET last_captured_at = NULL, last_image_url = NULL`;
}
