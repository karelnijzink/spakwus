// Copyright Nisse Group Ltd
// Regenerate public/status-fallback.json from the live Open511 feed (server-side,
// no CORS limits). Run on a schedule by the deploy workflow so the cold-start
// fallback the hub uses when a browser can't reach Open511 is never stale.
//
// This mirrors the browser logic in src/lib/liveConditions.ts — keep the two in
// sync (both classify by road state; a plain advisory stays OPEN).

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deriveStatus, getSegment } from "@nissegroup/shared";

const OPEN511_URL = "https://api.open511.gov.bc.ca/events";
const BBOX = { west: -123.35, south: 49.3, east: -122.6, north: 50.4 };

const WEBCAMS = [
  { id: "520", segmentId: "horseshoe-bay-squamish", label: "Hwy 99 at Britannia Beach" },
  { id: "765", segmentId: "horseshoe-bay-squamish", label: "Hwy 99 at Lions Bay" },
  { id: "179", segmentId: "squamish-whistler", label: "Hwy 99 at Alice Lake, Squamish" },
  { id: "690", segmentId: "squamish-whistler", label: "Hwy 99 north of Squamish (Culliton)" },
  { id: "596", segmentId: "whistler-pemberton", label: "Hwy 99 at Pemberton" },
  { id: "152", segmentId: "whistler-pemberton", label: "Hwy 99 at Wedge, north of Whistler" },
];

function segmentForLatLon(lat) {
  if (lat < 49.7) return "horseshoe-bay-squamish";
  if (lat < 50.12) return "squamish-whistler";
  return "whistler-pemberton";
}

function firstPoint(geo) {
  if (!geo) return null;
  const c = geo.coordinates;
  if (geo.type === "Point" && typeof c?.[0] === "number") return [c[0], c[1]];
  if (geo.type === "LineString" && Array.isArray(c?.[0])) return [c[0][0], c[0][1]];
  if (geo.type === "MultiLineString" && Array.isArray(c?.[0]?.[0])) return [c[0][0][0], c[0][0][1]];
  return null;
}

const isHwy99 = (ev) => (ev.roads ?? []).some((r) => /\b99\b|highway\s*99|hwy\s*99/i.test(r.name ?? ""));

function mapKind(ev) {
  const states = (ev.roads ?? []).map((r) => (r.state ?? "").toUpperCase()).filter(Boolean);
  if (states.some((s) => s === "CLOSED" || s === "BOTH_DIRECTIONS_CLOSED")) return "closure";
  if (states.some((s) => s.includes("ALTERNAT"))) return "alternating";
  if (states.some((s) => /SINGLE.?LANE|SOME.?LANES|MULTIPLE.?LANES|LANES?.?CLOSED|LANE.?REDUC/.test(s))) return "single-lane";
  if (states.length === 0) {
    const text = `${ev.headline ?? ""} ${ev.description ?? ""}`.toUpperCase();
    if (/\bRE-?OPEN|NOW OPEN|ALL CLEAR\b/.test(text)) return "cleared";
    if (/ROAD CLOSED|FULL CLOSURE|CLOSED IN BOTH|HIGHWAY CLOSED/.test(text)) return "closure";
  }
  return "delay";
}

async function fetchEvents() {
  const events = [];
  let url = `${OPEN511_URL}?format=json&status=ACTIVE&bbox=${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}&limit=200`;
  let guard = 0;
  while (url && guard++ < 12) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Open511 ${res.status}`);
    const data = await res.json();
    events.push(...(data.events ?? []));
    url = data.pagination?.next_url ?? null;
  }
  return events;
}

async function main() {
  const now = new Date();
  const events = await fetchEvents();
  const official = [];
  for (const ev of events) {
    if (ev.status && ev.status.toUpperCase() !== "ACTIVE") continue;
    if (!isHwy99(ev)) continue;
    const pt = firstPoint(ev.geography);
    if (!pt) continue;
    const [lon, lat] = pt;
    if (lon < BBOX.west || lon > BBOX.east || lat < BBOX.south || lat > BBOX.north) continue;
    official.push({
      id: ev.id,
      segmentId: segmentForLatLon(lat),
      kind: mapKind(ev),
      startedAt: ev.created ?? now.toISOString(),
      endedAt: null,
      updatedAt: ev.updated ?? ev.created ?? now.toISOString(),
      sourceId: ev.id,
    });
  }

  const corridor = deriveStatus([], official, [], now);
  const worst = corridor.segments.find((s) => s.status === corridor.status);
  const camBust = Math.floor(now.getTime() / 60_000);
  const snapshot = {
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
    incidents: official.filter((e) => e.kind !== "cleared").length,
  };

  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "status-fallback.json");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(snapshot), "utf8");
  console.log(`refresh-fallback: corridor=${snapshot.corridor.status} events=${official.length} -> ${out}`);
}

main().catch((err) => {
  console.error("refresh-fallback failed:", err);
  // Don't fail the deploy — a stale fallback is better than a broken build.
  process.exit(0);
});
