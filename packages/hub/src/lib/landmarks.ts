// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

/**
 * Fixed points of interest along the corridor — sightseeing/stop landmarks, not
 * live data. Shown on the map as a distinct marker style from cameras
 * (live feeds) and incidents (live conditions) so they never get confused for
 * either. Coordinates are approximate roadside locations (WGS84).
 */
export interface Landmark {
  id: string;
  name: string;
  description: string;
  lon: number;
  lat: number;
  /** Optional external link (park page, museum site, etc). */
  url?: string;
}

export const LANDMARKS: Landmark[] = [
  {
    id: "shannon-falls",
    name: "Shannon Falls Provincial Park",
    description: "One of BC's tallest waterfalls, right off Hwy 99 — a popular short stop and viewpoint.",
    lon: -123.1592,
    lat: 49.6725,
    url: "https://bcparks.ca/shannon-falls-park/",
  },
  {
    id: "britannia-beach",
    name: "Britannia Beach",
    description: "Historic mining townsite on Howe Sound, home to the Britannia Mine Museum.",
    lon: -123.2027,
    lat: 49.6438,
    url: "https://britanniaminemuseum.ca/",
  },
];
