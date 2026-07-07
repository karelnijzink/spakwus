// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import "dotenv/config";
import { loadConfig } from "../config.js";
import { createSql } from "./client.js";
import { migrate } from "./migrate.js";

async function main() {
  const config = loadConfig();
  const sql = createSql(config.DATABASE_URL);
  try {
    const applied = await migrate(sql);
    if (applied.length === 0) {
      console.log("Migrations up to date.");
    } else {
      console.log(`Applied ${applied.length} migration(s): ${applied.join(", ")}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
