// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export type Sql = postgres.Sql;
export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function createSql(url: string): Sql {
  return postgres(url, {
    max: 10,
    // PostGIS emits NOTICE lines on some operations; keep the logs quiet.
    onnotice: () => {},
  });
}

export function createDb(sql: Sql): Db {
  return drizzle(sql, { schema });
}

export interface DbContext {
  sql: Sql;
  db: Db;
}

export function createDbContext(url: string): DbContext {
  const sql = createSql(url);
  return { sql, db: createDb(sql) };
}
