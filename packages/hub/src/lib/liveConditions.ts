// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

//
// Live client-side conditions, straight from DriveBC's public Open511 feed
// (CORS-enabled), computed with the shared deterministic `deriveStatus`. This
// lets the hub run as a genuinely live, backend-free static site: no server, no
// "service degraded" fallback — the browser is the poller. Webcam stills load
// directly from DriveBC (the list API isn't CORS-enabled, so the corridor's
// cameras are pinned here).
//

import { deriveStatus, getSegment, type OfficialEvent, type OfficialEventKind, type SegmentId, type StatusLevel } from "@nissegroup/shared";
import { segmentForLatLon } from "./corridorGeo.js";
import type { GeoPoint, Incident, IncidentsResponse, SnapshotResponse } from "../api/types.js";

const OPEN511_URL = "https://api.open511.gov.bc.ca/events";
// The Sea to Sky corridor bounding box [west, south, east, north].
const BBOX = { west: -123.35, south: 49.3, east: -122.6, north: 50.4 };

/** Verified Highway 99 (Sea to Sky) DriveBC cameras, pinned per segment. */
const WEBCAMS: { id: string; segmentId: SegmentId; label: string }[] = [
  { id: "520", segmentId: "horseshoe-bay-squamish", label: "Hwy 99 at Britannia Beach" },
  { id: "765", segmentId: "horseshoe-bay-squamish", label: "Hwy 99 at Lions Bay" },
  { id: "179", segmentId: "squamish-whistler", label: "Hwy 99 at Alice Lake, Squamish" },
  { id: "690", segmentId: "squamish-whistler", label: "Hwy 99 north of Squamish (Culliton)" },
  { id: "596", segmentId: "whistler-pemberton", label: "Hwy 99 at Pemberton" },
  { id: "152", segmentId: "whistler-pemberton", label: "Hwy 99 at Wedge, north of Whistler" },
];

interface RawRoad {
  name?: string;
  state?: string;
}
interface RawEvent {
  id: string;
  status?: string;
  event_type?: string;
  severity?: string;
  headline?: string;
  description?: string;
  roads?: RawRoad[];
  geography?: { type: string; coordinates: unknown };
  created?: string;
  updated?: string;
}

// A tiny module cache — dedupes the snapshot + incidents queries onto one fetch,
// and doubles as the "last known good" so a transient Open511 blip can't take the
// feed down once it has loaded at least once.
let cache: { at: number; events: RawEvent[] } | null = null;

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllPages(): Promise<RawEvent[]> {
  const events: RawEvent[] = [];
  let url: string | null =
    `${OPEN511_URL}?format=json&status=ACTIVE&bbox=${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}&limit=200`;
  let guard = 0;
  while (url && guard++ < 12) {
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) throw new Error(`Open511 request failed: ${res.status}`);
    const data = (await res.json()) as { events?: RawEvent[]; pagination?: { next_url?: string | null } };
    events.push(...(data.events ?? []));
    url = data.pagination?.next_url ?? null;
  }
  return events;
}

async function fetchEvents(): Promise<RawEvent[]> {
  if (cache && Date.now() - cache.at < 25_000) return cache.events;
  // Two attempts with a short backoff; if both fail, serve the last-known events
  // rather than failing the feed. Only a cold failure (never loaded) throws, and
  // then the UI's own offline fallback takes over.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const events = await fetchAllPages();
      cache = { at: Date.now(), events };
      return events;
    } catch (err) {
      if (attempt === 1) {
        if (cache) return cache.events;
        throw err;
      }
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  return cache?.events ?? [];
}

/** First [lon, lat] of a Point / LineString / MultiLineString geography. */
function firstPoint(geo: RawEvent["geography"]): [number, number] | null {
  if (!geo) return null;
  const c = geo.coordinates as number[] | number[][] | number[][][];
  if (geo.type === "Point" && Array.isArray(c) && typeof c[0] === "number") {
    return [c[0] as number, c[1] as number];
  }
  if (geo.type === "LineString" && Array.isArray(c[0])) {
    const p = c[0] as number[];
    return [p[0]!, p[1]!];
  }
  if (geo.type === "MultiLineString" && Array.isArray(c[0]) && Array.isArray((c[0] as number[][])[0])) {
    const p = (c[0] as number[][])[0]!;
    return [p[0]!, p[1]!];
  }
  return null;
}

function isHwy99(ev: RawEvent): boolean {
  return (ev.roads ?? []).some((r) => /\b99\b|highway\s*99|hwy\s*99/i.test(r.name ?? ""));
}

function inBbox(lon: number, lat: number): boolean {
  return lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north;
}

/**
 * Map an Open511 event to a Spakwus kind based on the AUTHORITATIVE road `state`
 * field — the current condition — not the description. Construction/maintenance
 * events routinely describe scheduled alternating/single-lane work in their text
 * while the road state is ALL_LANES_OPEN (open right now); those are advisories,
 * not current restrictions, so only the state decides whether we restrict.
 */
function mapKind(ev: RawEvent): OfficialEventKind {
  const states = (ev.roads ?? []).map((r) => (r.state ?? "").toUpperCase()).filter(Boolean);

  // Full closure: an explicit CLOSED road state.
  if (states.some((s) => s === "CLOSED" || s === "BOTH_DIRECTIONS_CLOSED")) return "closure";
  // Alternating single-lane traffic control (flaggers / signals).
  if (states.some((s) => s.includes("ALTERNAT"))) return "alternating";
  // Some/one lane(s) actually closed right now.
  if (states.some((s) => /SINGLE.?LANE|SOME.?LANES|MULTIPLE.?LANES|LANES?.?CLOSED|LANE.?REDUC/.test(s))) {
    return "single-lane";
  }

  // No structured state (rare) — fall back to explicit full-closure wording only.
  if (states.length === 0) {
    const text = `${ev.headline ?? ""} ${ev.description ?? ""}`.toUpperCase();
    if (/\bRE-?OPEN|NOW OPEN|ALL CLEAR\b/.test(text)) return "cleared";
    if (/ROAD CLOSED|FULL CLOSURE|CLOSED IN BOTH|HIGHWAY CLOSED/.test(text)) return "closure";
  }

  // ALL_LANES_OPEN construction/maintenance and everything else → advisory (OPEN).
  return "delay";
}

interface Located {
  ev: RawEvent;
  lon: number;
  lat: number;
  segmentId: SegmentId;
  kind: OfficialEventKind;
}

function locate(events: RawEvent[]): Located[] {
  const out: Located[] = [];
  for (const ev of events) {
    if (ev.status && ev.status.toUpperCase() !== "ACTIVE") continue;
    if (!isHwy99(ev)) continue;
    const pt = firstPoint(ev.geography);
    if (!pt) continue;
    const [lon, lat] = pt;
    if (!inBbox(lon, lat)) continue;
    out.push({ ev, lon, lat, segmentId: segmentForLatLon(lat, lon), kind: mapKind(ev) });
  }
  return out;
}

function statusForKind(kind: OfficialEventKind): StatusLevel {
  if (kind === "closure") return "CLOSED";
  if (kind === "single-lane" || kind === "alternating") return "PARTIAL";
  return "OPEN"; // delay advisory
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function summarize(ev: RawEvent): string | null {
  const d = (ev.description ?? "").trim();
  if (d) return d.length > 160 ? `${d.slice(0, 157)}…` : d;
  return ev.headline ? titleCase(ev.headline) : null;
}

/** Live corridor snapshot (same shape the PWA already consumes). */
export async function fetchLiveSnapshot(): Promise<SnapshotResponse> {
  const now = new Date();
  const located = locate(await fetchEvents());
  const official: OfficialEvent[] = located.map((l) => ({
    id: l.ev.id,
    segmentId: l.segmentId,
    kind: l.kind,
    startedAt: l.ev.created ?? now.toISOString(),
    endedAt: null,
    updatedAt: l.ev.updated ?? l.ev.created ?? now.toISOString(),
    sourceId: l.ev.id,
  }));

  const corridor = deriveStatus([], official, [], now);
  const worst = corridor.segments.find((s) => s.status === corridor.status);
  const camBust = Math.floor(now.getTime() / 60_000); // refresh cam stills each minute

  return {
    source: "open511",
    generatedAt: now.toISOString(),
    confidence: corridor.confidence,
    corridor: {
      status: corridor.status,
      source: corridor.source,
      confidence: corridor.confidence,
      updatedAt: corridor.updatedAt,
      reason: worst?.reason ?? null,
    },
    segments: corridor.segments.map((s) => ({
      id: s.segmentId,
      name: getSegment(s.segmentId)?.name ?? s.segmentId,
      status: s.status,
      source: s.source,
      confidence: s.confidence,
      updatedAt: s.updatedAt,
      reason: s.reason ?? null,
    })),
    webcams: WEBCAMS.map((w) => ({
      id: w.id,
      segmentId: w.segmentId,
      label: w.label,
      url: `https://www.drivebc.ca/images/${w.id}.jpg?t=${camBust}`,
      capturedAt: now.toISOString(),
    })),
    incidents: located.filter((l) => l.kind !== "cleared").length,
  };
}

const SEV_RANK: Record<StatusLevel, number> = { CLOSED: 2, PARTIAL: 1, OPEN: 0 };

/** Live incidents list (for the incident cards + map markers). */
export async function fetchLiveIncidents(_activeOnly = true): Promise<IncidentsResponse> {
  const now = new Date();
  const located = locate(await fetchEvents()).filter((l) => l.kind !== "cleared");
  const incidents: Incident[] = located.map((l) => {
    const status = statusForKind(l.kind);
    const geometry: GeoPoint = { type: "Point", coordinates: [l.lon, l.lat] };
    return {
      id: l.ev.id.replace(/[^a-zA-Z0-9]+/g, "-"),
      segmentId: l.segmentId,
      kind: l.kind,
      status,
      source: "official",
      confidence: "official",
      summary: summarize(l.ev),
      startedAt: l.ev.created ?? now.toISOString(),
      endedAt: null,
      active: true,
      updatedAt: l.ev.updated ?? now.toISOString(),
      geometry,
      reports: [],
      requestCount: 0,
    };
  });
  incidents.sort(
    (a, b) => SEV_RANK[b.status] - SEV_RANK[a.status] || b.updatedAt.localeCompare(a.updatedAt),
  );
  return { source: "open511", timestamp: now.toISOString(), activeOnly: true, incidents };
}
