// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type { Confidence, StatusLevel, StatusSource } from "@nissegroup/shared";
import type { DbContext } from "../db/client.js";
import { getCorridorStatus, getIncidents, getWebcams } from "../api/queries.js";

/**
 * The compact corridor snapshot the PWA caches and the static fallback mirrors.
 * This is the single source of truth for both `GET /api/status/snapshot` and the
 * CDN-published `status-fallback.json`, so the offline/degraded payload can never
 * drift from the live one.
 */
export interface CorridorSnapshot {
  source: "spakwus";
  generatedAt: string;
  confidence: Confidence;
  corridor: {
    status: StatusLevel;
    source: StatusSource;
    confidence: Confidence;
    updatedAt: string;
    reason: string | null;
  };
  segments: Array<{
    id: string;
    name: string;
    status: StatusLevel;
    source: StatusSource;
    confidence: Confidence;
    updatedAt: string;
    reason: string | null;
  }>;
  webcams: Array<{
    id: string;
    segmentId: string;
    label: string;
    url: string;
    capturedAt: string | null;
  }>;
  incidents: number;
}

export async function buildSnapshot(ctx: DbContext, now: Date = new Date()): Promise<CorridorSnapshot> {
  const [corridor, webcams, activeIncidents] = await Promise.all([
    getCorridorStatus(ctx),
    getWebcams(ctx),
    getIncidents(ctx, true),
  ]);
  const worst = corridor.segments.find((s) => s.status === corridor.status);
  return {
    source: "spakwus",
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
      name: s.name,
      status: s.status,
      source: s.source,
      confidence: s.confidence,
      updatedAt: s.updatedAt,
      reason: s.reason,
    })),
    webcams: webcams.map((w) => ({
      id: w.id,
      segmentId: w.segmentId,
      label: w.label,
      url: w.lastImageUrl ?? w.imageUrl,
      capturedAt: w.capturedAt,
    })),
    incidents: activeIncidents.length,
  };
}

/**
 * A content signature used to decide whether the static fallback needs
 * republishing. Deliberately excludes `generatedAt` (which changes every build)
 * so we only write on a real status/reason/capture change.
 */
export function snapshotSignature(snap: CorridorSnapshot): string {
  const seg = snap.segments.map((s) => `${s.id}:${s.status}:${s.source}:${s.reason ?? ""}:${s.updatedAt}`);
  const cams = snap.webcams.map((w) => `${w.id}:${w.capturedAt ?? ""}`);
  return `${snap.corridor.status}|${snap.corridor.reason ?? ""}|${snap.incidents}|${seg.join(",")}|${cams.join(",")}`;
}
