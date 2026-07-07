// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { ReportKind } from "@nissegroup/shared";
import { HWY99_BBOX } from "../config.js";
import type { Open511Event, Open511Geography } from "./types.js";

/** True when the Open511 event's status is ACTIVE (case-insensitive). */
export function isActive(event: Open511Event): boolean {
  return (event.status ?? "").toUpperCase() === "ACTIVE";
}

/**
 * Map an Open511 event to a Spakwus report kind. Prefers the structured
 * `roads[].state` and falls back to keywords in the headline/description.
 * Only a genuine full closure maps to `closure`; "some lanes closed" is partial.
 */
export function mapEventKind(event: Open511Event): ReportKind {
  const state = (event.roads?.[0]?.state ?? "").toUpperCase().trim();
  const text = [state, event.headline ?? "", event.description ?? ""].join(" ").toUpperCase();

  const isFullClosure =
    state === "CLOSED" ||
    /\b(ROAD|HIGHWAY|HWY|FULLY|FULL)\s+CLOSED\b/.test(text) ||
    /CLOSED\s+IN\s+BOTH\s+DIRECTIONS/.test(text);
  if (isFullClosure) return "closure";

  if (/ALTERNAT/.test(text)) return "alternating";
  if (/SINGLE\s+LANE|ONE\s+LANE|LANE\s+CLOSED|SOME\s+LANES/.test(text)) return "single-lane";
  return "delay";
}

/** Extract a representative [lon, lat] point from an event geography. */
export function representativePoint(geo: Open511Geography | undefined): [number, number] | null {
  if (!geo) return null;
  if (geo.type === "Point") {
    const c = (geo as { coordinates: [number, number] }).coordinates;
    return Array.isArray(c) && c.length >= 2 ? [c[0], c[1]] : null;
  }
  if (geo.type === "LineString") {
    const c = (geo as { coordinates: [number, number][] }).coordinates;
    return c.length > 0 ? c[Math.floor(c.length / 2)]! : null;
  }
  if (geo.type === "MultiLineString") {
    const c = (geo as { coordinates: [number, number][][] }).coordinates;
    const first = c[0];
    return first && first.length > 0 ? first[Math.floor(first.length / 2)]! : null;
  }
  return null;
}

/** True when [lon, lat] falls inside the Highway 99 corridor bounding box. */
export function inHwy99Bbox(point: [number, number] | null): boolean {
  if (!point) return false;
  const [lon, lat] = point;
  return (
    lon >= HWY99_BBOX.west &&
    lon <= HWY99_BBOX.east &&
    lat >= HWY99_BBOX.south &&
    lat <= HWY99_BBOX.north
  );
}

export interface NormalizedEvent {
  externalId: string;
  kind: ReportKind;
  rawText: string;
  point: [number, number];
  createdAt: Date;
}

/**
 * Normalize an Open511 event into the fields needed to upsert a report, or
 * null when the event is not active or falls outside the Highway 99 corridor.
 * Pure: no I/O; segment assignment (which needs the DB) happens downstream.
 */
export function normalizeEvent(event: Open511Event): NormalizedEvent | null {
  if (!isActive(event)) return null;

  const point = representativePoint(event.geography);
  if (!inHwy99Bbox(point)) return null;

  const rawText = (event.description ?? event.headline ?? "").trim();
  const createdRaw = event.created ?? event.updated;
  const createdAt = createdRaw ? new Date(createdRaw) : new Date(0);

  return {
    externalId: event.id,
    kind: mapEventKind(event),
    rawText,
    point: point!,
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date(0) : createdAt,
  };
}
