// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "./client.js";

/**
 * Location of the hand-written SQL migrations. These are authoritative because
 * they manage PostGIS extension setup, geometry columns, GiST indexes and the
 * segment/webcam seed data — things Drizzle-kit's generic generation does not
 * express well. `src/db/schema.ts` remains the source of truth for queries.
 *
 * Resolves relative to this module so it works both from `dist/db` (built) and
 * `src/db` (tsx), since the `drizzle/` folder sits at the package root.
 */
const migrationsDir = fileURLToPath(new URL("../../drizzle/", import.meta.url));

/** Apply all pending SQL migrations in lexical order, tracked in `_migrations`. */
export async function migrate(sql: Sql, dir: string = migrationsDir): Promise<string[]> {
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];

  for (const file of files) {
    const done = await sql`SELECT 1 FROM _migrations WHERE name = ${file}`;
    if (done.length > 0) continue;

    const contents = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`INSERT INTO _migrations (name) VALUES (${file})`;
    });
    applied.push(file);
  }

  return applied;
}
