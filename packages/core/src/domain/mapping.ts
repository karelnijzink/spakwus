// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import type {
  OfficialEvent,
  OfficialEventKind,
  Report as SharedReport,
  StatusSource,
} from "@nissegroup/shared";
import type { ReportRow, ReportSource } from "../db/schema.js";

/**
 * Bridge between the DB `reports` table and the two distinct inputs
 * `deriveStatus` expects:
 *
 *  - rows with source 'open511' become `OfficialEvent`s (authoritative, not
 *    subject to the 45-minute corroboration window), and
 *  - all other rows become community/steward `Report`s.
 *
 * This is where the "Open511 events are stored as reports" ingestion choice is
 * reconciled with the shared state machine's official-vs-report distinction.
 */

export function reportRowToOfficialEvent(row: ReportRow): OfficialEvent {
  return {
    id: row.id,
    segmentId: row.segmentId,
    // Open511 active events are only ever closures or restrictions; the mapper
    // never emits 'clear'/'cleared' for an active row.
    kind: row.kind as OfficialEventKind,
    startedAt: row.createdAt.toISOString(),
    endedAt: row.active ? null : row.updatedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    sourceId: row.externalId ?? undefined,
  };
}

export function reportRowToSharedReport(row: ReportRow): SharedReport {
  return {
    id: row.id,
    segmentId: row.segmentId,
    kind: row.kind,
    reporterId: row.reporterId,
    isSteward: row.isSteward,
    createdAt: row.createdAt.toISOString(),
    ...(row.rawText ? { note: row.rawText } : {}),
  };
}

/** Map a DB report source onto the shared status `source` provenance. */
export function sourceToStatusSource(source: ReportSource): StatusSource {
  switch (source) {
    case "open511":
      return "official";
    case "steward":
      return "steward";
    case "community":
    case "web":
      return "community";
  }
}

/**
 * Partition active report rows into the official-event and community-report
 * inputs for `deriveStatus`.
 */
export function partitionReports(rows: ReportRow[]): {
  officialEvents: OfficialEvent[];
  reports: SharedReport[];
} {
  const officialEvents: OfficialEvent[] = [];
  const reports: SharedReport[] = [];
  for (const row of rows) {
    if (row.source === "open511") {
      officialEvents.push(reportRowToOfficialEvent(row));
    } else {
      reports.push(reportRowToSharedReport(row));
    }
  }
  return { officialEvents, reports };
}
