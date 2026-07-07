// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config } from "../config.js";
import type { CorridorSnapshot } from "./snapshot.js";
import { consoleLogger, type Logger } from "../workers/logger.js";

/**
 * Publish the last-known corridor snapshot to a highly-available location that
 * survives a backend outage. The hub fetches this file when the live API is
 * unreachable and shows a "service degraded — last confirmed at <time>" banner.
 *
 * Two backends, chosen by SNAPSHOT_PUBLISH:
 *  - "file": writes SNAPSHOT_FILE (a path a CDN/static host serves, or a volume
 *    a sidecar syncs to object storage). Always safe; the default.
 *  - "http": additionally PUTs the JSON to SNAPSHOT_HTTP_URL (a Cloudflare
 *    Worker / R2 / S3 pre-signed endpoint) with an optional bearer token.
 *
 * Publishing is best-effort and never throws into the caller — a failed publish
 * degrades freshness of the fallback, it must never break the live path.
 */
export async function publishSnapshot(
  snap: CorridorSnapshot,
  config: Config,
  log: Logger = consoleLogger,
): Promise<boolean> {
  if (config.SNAPSHOT_PUBLISH === "none") return false;
  const body = JSON.stringify(snap);
  let ok = false;

  // File backend (always attempted for "file" and as a local mirror for "http").
  try {
    await mkdir(dirname(config.SNAPSHOT_FILE), { recursive: true });
    await writeFile(config.SNAPSHOT_FILE, body, "utf8");
    ok = true;
  } catch (err) {
    log.warn(`snapshot-publisher: file write failed (${config.SNAPSHOT_FILE})`, err);
  }

  if (config.SNAPSHOT_PUBLISH === "http") {
    if (!config.SNAPSHOT_HTTP_URL) {
      log.warn("snapshot-publisher: SNAPSHOT_PUBLISH=http but SNAPSHOT_HTTP_URL is unset");
    } else {
      try {
        const res = await fetch(config.SNAPSHOT_HTTP_URL, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "cache-control": "public, max-age=30",
            ...(config.SNAPSHOT_HTTP_TOKEN ? { authorization: `Bearer ${config.SNAPSHOT_HTTP_TOKEN}` } : {}),
          },
          body,
        });
        if (!res.ok) {
          log.warn(`snapshot-publisher: HTTP PUT failed (${res.status} ${res.statusText})`);
        } else {
          ok = true;
        }
      } catch (err) {
        log.warn("snapshot-publisher: HTTP PUT threw", err);
      }
    }
  }

  return ok;
}
