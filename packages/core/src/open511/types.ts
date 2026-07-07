// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

/**
 * A minimal, tolerant view of the BC Open511 events API
 * (https://api.open511.gov.bc.ca/events?format=json). Only the fields Spakwus
 * consumes are typed; everything else is ignored.
 */

export interface Open511Road {
  name?: string;
  from?: string;
  to?: string;
  direction?: string;
  /** e.g. "CLOSED", "SINGLE LANE ALTERNATING", "SOME LANES CLOSED". */
  state?: string;
}

export interface Open511GeoPoint {
  type: "Point";
  coordinates: [number, number];
}
export interface Open511GeoLineString {
  type: "LineString";
  coordinates: [number, number][];
}
export interface Open511GeoMultiLineString {
  type: "MultiLineString";
  coordinates: [number, number][][];
}
export type Open511Geography =
  | Open511GeoPoint
  | Open511GeoLineString
  | Open511GeoMultiLineString
  | { type: string; coordinates: unknown };

export interface Open511Event {
  id: string;
  status?: string; // "ACTIVE" | "ARCHIVED"
  headline?: string;
  description?: string;
  event_type?: string;
  severity?: string;
  created?: string;
  updated?: string;
  roads?: Open511Road[];
  geography?: Open511Geography;
}

export interface Open511Pagination {
  offset?: number;
  next_url?: string | null;
}

export interface Open511Response {
  events: Open511Event[];
  pagination?: Open511Pagination;
}
