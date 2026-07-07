// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { describe, expect, it } from "vitest";
import {
  inHwy99Bbox,
  isActive,
  mapEventKind,
  normalizeEvent,
  representativePoint,
} from "../src/open511/normalize.js";
import type { Open511Event } from "../src/open511/types.js";

function event(partial: Partial<Open511Event>): Open511Event {
  return { id: "e1", status: "ACTIVE", ...partial };
}

describe("open511 normalize — kind mapping", () => {
  it("maps a full road closure to 'closure'", () => {
    expect(mapEventKind(event({ roads: [{ state: "CLOSED" }] }))).toBe("closure");
    expect(mapEventKind(event({ description: "Highway 99 closed in both directions" }))).toBe("closure");
  });

  it("maps 'some lanes closed' to 'single-lane', not a full closure", () => {
    expect(mapEventKind(event({ roads: [{ state: "SOME LANES CLOSED" }] }))).toBe("single-lane");
  });

  it("maps alternating traffic to 'alternating'", () => {
    expect(mapEventKind(event({ roads: [{ state: "SINGLE LANE ALTERNATING" }] }))).toBe("alternating");
  });

  it("falls back to 'delay'", () => {
    expect(mapEventKind(event({ description: "Expect major delays" }))).toBe("delay");
  });
});

describe("open511 normalize — active + bbox filters", () => {
  it("recognizes ACTIVE status case-insensitively", () => {
    expect(isActive(event({ status: "ACTIVE" }))).toBe(true);
    expect(isActive(event({ status: "active" }))).toBe(true);
    expect(isActive(event({ status: "ARCHIVED" }))).toBe(false);
  });

  it("extracts a representative point from Point/LineString geographies", () => {
    expect(representativePoint({ type: "Point", coordinates: [-123.1, 49.9] })).toEqual([-123.1, 49.9]);
    expect(
      representativePoint({ type: "LineString", coordinates: [[-123.1, 49.9], [-123.0, 50.0]] }),
    ).toEqual([-123.0, 50.0]);
  });

  it("bbox check keeps corridor points and rejects far-away ones", () => {
    expect(inHwy99Bbox([-123.1, 49.9])).toBe(true);
    expect(inHwy99Bbox([-79.38, 43.65])).toBe(false); // Toronto
    expect(inHwy99Bbox(null)).toBe(false);
  });
});

describe("open511 normalize — normalizeEvent", () => {
  it("normalizes an active corridor event", () => {
    const n = normalizeEvent(
      event({
        id: "DBC/1",
        description: "Highway 99 closed due to a vehicle incident.",
        roads: [{ state: "CLOSED" }],
        geography: { type: "Point", coordinates: [-123.1, 49.95] },
        created: "2026-07-06T10:00:00Z",
      }),
    );
    expect(n).not.toBeNull();
    expect(n!.externalId).toBe("DBC/1");
    expect(n!.kind).toBe("closure");
    expect(n!.point).toEqual([-123.1, 49.95]);
    expect(n!.createdAt.toISOString()).toBe("2026-07-06T10:00:00.000Z");
  });

  it("drops archived events", () => {
    expect(normalizeEvent(event({ status: "ARCHIVED", geography: { type: "Point", coordinates: [-123.1, 49.95] } }))).toBeNull();
  });

  it("drops events outside the corridor bbox", () => {
    expect(normalizeEvent(event({ geography: { type: "Point", coordinates: [-79.38, 43.65] } }))).toBeNull();
  });
});
