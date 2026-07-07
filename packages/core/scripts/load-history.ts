// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

/**
 * Backfill `historical_events` from DriveBC historical event CSV exports.
 *
 * DriveBC publishes historical event data (incidents, closures, construction)
 * via its open-data portal. The exact column set has varied over the years, so
 * this loader is deliberately tolerant: it maps a range of common header names,
 * filters to the Sea to Sky (Hwy 99) corridor by road name or coordinates,
 * classifies closures, assigns the nearest corridor segment via PostGIS, and
 * upserts idempotently by event id (safe to re-run).
 *
 * Usage:
 *   pnpm --filter @nissegroup/core run load:history -- path/to/events.csv [more.csv ...]
 *   pnpm --filter @nissegroup/core run load:history -- --dry-run path/to/events.csv
 *
 * Get the CSVs from the DriveBC / BC open-data portal (see infra/RUNBOOK.md).
 */

import { readFile } from "node:fs/promises";
import { loadConfig, HWY99_BBOX } from "../src/config.js";
import { createDbContext, type DbContext } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";

// --- Minimal RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF) ----------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // swallow; handled by the following \n
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** Case/space/underscore-insensitive header lookup across a list of candidates. */
function pick(headerIndex: Map<string, number>, cols: string[], candidates: string[]): string | null {
  for (const cand of candidates) {
    const norm = cand.toLowerCase().replace(/[\s_-]+/g, "");
    const idx = headerIndex.get(norm);
    if (idx !== undefined && cols[idx] !== undefined) {
      const v = cols[idx].trim();
      if (v !== "") return v;
    }
  }
  return null;
}

function parseNum(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function looksLikeHwy99(road: string | null, description: string | null): boolean {
  const hay = `${road ?? ""} ${description ?? ""}`.toLowerCase();
  return /(highway|hwy|route|road)?\s*99\b/.test(hay) || /sea[\s-]?to[\s-]?sky/.test(hay);
}

function inCorridorBbox(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return false;
  return lng >= HWY99_BBOX.west && lng <= HWY99_BBOX.east && lat >= HWY99_BBOX.south && lat <= HWY99_BBOX.north;
}

function isClosure(eventType: string | null, severity: string | null, status: string | null, description: string | null): boolean {
  const hay = `${eventType ?? ""} ${severity ?? ""} ${status ?? ""} ${description ?? ""}`.toLowerCase();
  if (/reopen|re-open|now open|cleared/.test(hay)) return false;
  return /clos(ed|ure)|full closure|road closed|both directions closed/.test(hay);
}

interface ParsedEvent {
  id: string;
  eventType: string | null;
  severity: string | null;
  isClosure: boolean;
  roadName: string | null;
  direction: string | null;
  description: string | null;
  lat: number | null;
  lng: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  updatedAt: Date | null;
}

async function nearestSegment(ctx: DbContext, lng: number, lat: number): Promise<string | null> {
  const rows = await ctx.sql<{ id: string }[]>`
    SELECT id FROM segments
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

async function upsert(ctx: DbContext, e: ParsedEvent, segmentId: string | null): Promise<void> {
  const durationMinutes =
    e.startedAt && e.endedAt ? Math.max(0, Math.round((e.endedAt.getTime() - e.startedAt.getTime()) / 60000)) : null;
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const geomLng = e.lng;
  const geomLat = e.lat;

  await ctx.sql`
    INSERT INTO historical_events
      (id, event_type, severity, is_closure, road_name, direction, segment_id, description, geom,
       started_at, ended_at, updated_at, duration_minutes)
    VALUES (
      ${e.id}, ${e.eventType}, ${e.severity}, ${e.isClosure}, ${e.roadName}, ${e.direction}, ${segmentId}, ${e.description},
      ${geomLng !== null && geomLat !== null ? ctx.sql`ST_SetSRID(ST_MakePoint(${geomLng}, ${geomLat}), 4326)` : ctx.sql`NULL`},
      ${iso(e.startedAt)}::timestamptz, ${iso(e.endedAt)}::timestamptz, ${iso(e.updatedAt)}::timestamptz, ${durationMinutes}
    )
    ON CONFLICT (id) DO UPDATE SET
      event_type = EXCLUDED.event_type,
      severity = EXCLUDED.severity,
      is_closure = EXCLUDED.is_closure,
      road_name = EXCLUDED.road_name,
      direction = EXCLUDED.direction,
      segment_id = EXCLUDED.segment_id,
      description = EXCLUDED.description,
      geom = EXCLUDED.geom,
      started_at = EXCLUDED.started_at,
      ended_at = EXCLUDED.ended_at,
      updated_at = EXCLUDED.updated_at,
      duration_minutes = EXCLUDED.duration_minutes`;
}

async function loadFile(ctx: DbContext, file: string, dryRun: boolean): Promise<{ scanned: number; kept: number; loaded: number }> {
  const text = await readFile(file, "utf8");
  const rows = parseCsv(text);
  if (rows.length < 2) return { scanned: 0, kept: 0, loaded: 0 };

  const header = rows[0]!.map((h) => h.trim());
  const headerIndex = new Map<string, number>();
  header.forEach((h, i) => headerIndex.set(h.toLowerCase().replace(/[\s_-]+/g, ""), i));

  let scanned = 0;
  let kept = 0;
  let loaded = 0;
  let synthetic = 0;

  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r]!;
    scanned++;

    const road = pick(headerIndex, cols, ["road_name", "roadway", "route", "highway", "road", "location"]);
    const description = pick(headerIndex, cols, ["description", "headline", "name", "details", "message", "comment"]);
    const lat = parseNum(pick(headerIndex, cols, ["latitude", "lat", "y"]));
    const lng = parseNum(pick(headerIndex, cols, ["longitude", "long", "lon", "lng", "x"]));

    if (!looksLikeHwy99(road, description) && !inCorridorBbox(lat, lng)) continue;
    kept++;

    const eventType = pick(headerIndex, cols, ["event_type", "type", "eventtype", "category", "class"]);
    const severity = pick(headerIndex, cols, ["severity", "impact", "priority"]);
    const status = pick(headerIndex, cols, ["status", "state", "condition"]);
    const direction = pick(headerIndex, cols, ["direction", "direction_of_travel", "directions", "bound"]);
    const startedAt = parseDate(
      pick(headerIndex, cols, ["start", "started_at", "start_time", "created", "created_at", "first_reported", "reported"]),
    );
    const endedAt = parseDate(pick(headerIndex, cols, ["end", "ended_at", "end_time", "cleared", "closed_at", "resolved"]));
    const updatedAt = parseDate(pick(headerIndex, cols, ["updated", "updated_at", "last_updated", "modified"]));

    let id = pick(headerIndex, cols, ["id", "event_id", "eventid", "uuid", "reference", "ref"]);
    if (!id) {
      // Synthesize a stable id from the salient fields so re-runs stay idempotent.
      id = `syn-${Buffer.from(`${road ?? ""}|${startedAt?.toISOString() ?? ""}|${description ?? ""}`).toString("base64url").slice(0, 40)}`;
      synthetic++;
    }

    const event: ParsedEvent = {
      id,
      eventType,
      severity,
      isClosure: isClosure(eventType, severity, status, description),
      roadName: road,
      direction,
      description: description ? description.slice(0, 2000) : null,
      lat,
      lng,
      startedAt,
      endedAt,
      updatedAt,
    };

    if (!dryRun) {
      const segmentId = inCorridorBbox(lat, lng) ? await nearestSegment(ctx, lng!, lat!) : null;
      await upsert(ctx, event, segmentId);
    }
    loaded++;
  }

  if (synthetic > 0) console.log(`  note: ${synthetic} row(s) had no id column; synthesized stable ids.`);
  return { scanned, kept, loaded };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const files = args.filter((a) => !a.startsWith("--"));
  if (files.length === 0) {
    console.error("Usage: load:history -- [--dry-run] <events.csv> [more.csv ...]");
    process.exit(1);
  }

  const config = loadConfig();
  const ctx = createDbContext(config.DATABASE_URL);
  await migrate(ctx.sql);

  let scanned = 0;
  let kept = 0;
  let loaded = 0;
  for (const file of files) {
    console.log(`Loading ${file}${dryRun ? " (dry run)" : ""}…`);
    const r = await loadFile(ctx, file, dryRun);
    console.log(`  scanned=${r.scanned} corridor=${r.kept} ${dryRun ? "would-load" : "loaded"}=${r.loaded}`);
    scanned += r.scanned;
    kept += r.kept;
    loaded += r.loaded;
  }
  console.log(`Done. scanned=${scanned} corridor=${kept} ${dryRun ? "would-load" : "loaded"}=${loaded}`);
  await ctx.sql.end();
}

void main();
