// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { HWY99_BBOX } from "../config.js";
import type { Open511Event, Open511Response } from "./types.js";

export type FetchFn = typeof fetch;

/**
 * Fetch all currently-active Open511 events for the Highway 99 bounding box,
 * following pagination via `pagination.next_url`. Server-side filtering uses the
 * `bbox` and `status=ACTIVE` query params; downstream code re-checks both.
 */
export async function fetchOpen511Events(
  baseUrl: string,
  fetchFn: FetchFn = fetch,
  maxPages = 20,
): Promise<Open511Event[]> {
  const bbox = `${HWY99_BBOX.west},${HWY99_BBOX.south},${HWY99_BBOX.east},${HWY99_BBOX.north}`;
  const first = new URL(baseUrl);
  first.searchParams.set("format", "json");
  first.searchParams.set("status", "ACTIVE");
  first.searchParams.set("bbox", bbox);

  const events: Open511Event[] = [];
  let url: string | null = first.toString();
  let pages = 0;

  while (url && pages < maxPages) {
    const res: Response = await fetchFn(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`Open511 request failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as Open511Response;
    if (Array.isArray(body.events)) events.push(...body.events);

    const next = body.pagination?.next_url ?? null;
    url = next && next !== url ? next : null;
    pages += 1;
  }

  return events;
}
