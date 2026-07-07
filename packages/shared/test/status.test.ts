// Copyright Nisse Group Ltd
// SPDX-License-Identifier: LicenseRef-TBD (see LICENSE decision note in README)

import { describe, it, expect } from "vitest";
import {
  deriveStatus,
  CORROBORATION_WINDOW_MS,
  SEGMENT_IDS,
  type OfficialEvent,
  type Report,
  type SegmentId,
  type SegmentStatus,
  type StewardOverride,
} from "../src/index.js";

const NOW = new Date("2026-07-06T12:00:00.000Z");
const SEG: SegmentId = "squamish-whistler";

/** Minutes-before-now as an ISO string. */
function ago(minutes: number, base: Date = NOW): string {
  return new Date(base.getTime() - minutes * 60_000).toISOString();
}

function report(overrides: Partial<Report> & { id: string }): Report {
  return {
    segmentId: SEG,
    kind: "closure",
    reporterId: overrides.id + "-reporter",
    isSteward: false,
    createdAt: ago(5),
    ...overrides,
  };
}

function officialEvent(overrides: Partial<OfficialEvent> & { id: string }): OfficialEvent {
  return {
    segmentId: SEG,
    kind: "closure",
    startedAt: ago(10),
    endedAt: null,
    updatedAt: ago(10),
    ...overrides,
  };
}

function override(overrides: Partial<StewardOverride> & { id: string }): StewardOverride {
  return {
    segmentId: SEG,
    status: "CLOSED",
    reason: "Manual override",
    stewardId: "steward-1",
    createdAt: ago(2),
    expiresAt: null,
    ...overrides,
  };
}

function seg(status: ReturnType<typeof deriveStatus>, id: SegmentId = SEG): SegmentStatus {
  return status.segments.find((s) => s.segmentId === id)!;
}

describe("deriveStatus — rule 1: default OPEN", () => {
  it("returns OPEN for every segment with no inputs", () => {
    const result = deriveStatus([], [], [], NOW);
    expect(result.status).toBe("OPEN");
    expect(result.segments).toHaveLength(3);
    for (const s of result.segments) {
      expect(s.status).toBe("OPEN");
      expect(s.source).toBe("default");
      expect(s.confidence).toBe("assumed");
      expect(s.incidents).toEqual([]);
    }
  });

  it("returns all three configured segments, south → north", () => {
    const result = deriveStatus([], [], [], NOW);
    expect(result.segments.map((s) => s.segmentId)).toEqual([...SEGMENT_IDS]);
  });
});

describe("deriveStatus — rule 2: CLOSED conditions", () => {
  it("(a) closes on an official Open511 closure", () => {
    const result = deriveStatus([], [officialEvent({ id: "e1" })], [], NOW);
    const s = seg(result);
    expect(s.status).toBe("CLOSED");
    expect(s.source).toBe("official");
    expect(s.confidence).toBe("official");
    expect(s.incidents[0]!.reportIds).toEqual([]);
  });

  it("(b) closes on two independent corroborating reports in the window", () => {
    const reports = [
      report({ id: "r1", reporterId: "alice", createdAt: ago(30) }),
      report({ id: "r2", reporterId: "bob", createdAt: ago(5) }),
    ];
    const s = seg(deriveStatus(reports, [], [], NOW));
    expect(s.status).toBe("CLOSED");
    expect(s.source).toBe("community");
    expect(s.confidence).toBe("confirmed");
    expect(s.incidents[0]!.reportIds.sort()).toEqual(["r1", "r2"]);
  });

  it("does NOT close on two reports from the SAME reporter (not independent)", () => {
    const reports = [
      report({ id: "r1", reporterId: "alice", createdAt: ago(30) }),
      report({ id: "r2", reporterId: "alice", createdAt: ago(5) }),
    ];
    const s = seg(deriveStatus(reports, [], [], NOW));
    expect(s.status).toBe("OPEN");
    expect(s.confidence).toBe("unconfirmed");
  });

  it("does NOT close when the two reports straddle a >45min window", () => {
    const reports = [
      report({ id: "r1", reporterId: "alice", createdAt: ago(50) }), // outside window
      report({ id: "r2", reporterId: "bob", createdAt: ago(5) }),
    ];
    const s = seg(deriveStatus(reports, [], [], NOW));
    // Only r2 is recent -> single unconfirmed -> OPEN.
    expect(s.status).toBe("OPEN");
    expect(s.confidence).toBe("unconfirmed");
  });

  it("a single steward report corroborates alone -> CLOSED", () => {
    const reports = [report({ id: "r1", reporterId: "steward-a", isSteward: true })];
    const s = seg(deriveStatus(reports, [], [], NOW));
    expect(s.status).toBe("CLOSED");
    expect(s.source).toBe("steward");
    expect(s.confidence).toBe("confirmed");
  });
});

describe("deriveStatus — rule 3: single unconfirmed non-steward report", () => {
  it("never sets CLOSED; yields an unconfirmed incident and leaves OPEN", () => {
    const reports = [report({ id: "r1", reporterId: "alice" })];
    const s = seg(deriveStatus(reports, [], [], NOW));
    expect(s.status).toBe("OPEN");
    expect(s.source).toBe("community");
    expect(s.confidence).toBe("unconfirmed");
    expect(s.incidents).toHaveLength(1);
    expect(s.incidents[0]!.confidence).toBe("unconfirmed");
    expect(s.incidents[0]!.reportIds).toEqual(["r1"]);
  });
});

describe("deriveStatus — rule 4: PARTIAL states", () => {
  for (const kind of ["single-lane", "alternating", "delay"] as const) {
    it(`maps a steward '${kind}' report to PARTIAL`, () => {
      const reports = [report({ id: "r1", kind, isSteward: true, reporterId: "steward-a" })];
      const s = seg(deriveStatus(reports, [], [], NOW));
      expect(s.status).toBe("PARTIAL");
      expect(s.incidents[0]!.partialKind).toBe(kind);
      expect(s.confidence).toBe("confirmed");
    });
  }

  it("an official partial event yields PARTIAL with official confidence", () => {
    const events = [officialEvent({ id: "e1", kind: "single-lane" })];
    const s = seg(deriveStatus([], events, [], NOW));
    expect(s.status).toBe("PARTIAL");
    expect(s.source).toBe("official");
    expect(s.confidence).toBe("official");
  });

  it("a full closure outranks a partial on the same segment", () => {
    const reports = [
      report({ id: "r1", reporterId: "alice", kind: "delay" }),
      report({ id: "r2", reporterId: "bob", isSteward: true, kind: "closure" }),
    ];
    const s = seg(deriveStatus(reports, [], [], NOW));
    expect(s.status).toBe("CLOSED");
  });

  it("a SINGLE non-steward partial report does NOT flip to PARTIAL (stays OPEN, unconfirmed)", () => {
    const reports = [report({ id: "r1", reporterId: "alice", kind: "delay" })];
    const s = seg(deriveStatus(reports, [], [], NOW));
    expect(s.status).toBe("OPEN");
    expect(s.confidence).toBe("unconfirmed");
    expect(s.incidents[0]!.partialKind).toBe("delay");
  });

  it("TWO independent non-steward partial reports corroborate to PARTIAL", () => {
    const reports = [
      report({ id: "r1", reporterId: "alice", kind: "delay", createdAt: ago(10) }),
      report({ id: "r2", reporterId: "bob", kind: "delay", createdAt: ago(5) }),
    ];
    const s = seg(deriveStatus(reports, [], [], NOW));
    expect(s.status).toBe("PARTIAL");
    expect(s.source).toBe("community");
    expect(s.confidence).toBe("confirmed");
  });
});

describe("deriveStatus — rule 5: clearing", () => {
  it("clears via an official 'cleared' event more recent than the closure", () => {
    const reports = [
      report({ id: "r1", reporterId: "alice", createdAt: ago(30) }),
      report({ id: "r2", reporterId: "bob", createdAt: ago(30) }),
    ];
    const events = [officialEvent({ id: "e1", kind: "cleared", updatedAt: ago(2), startedAt: ago(2) })];
    const s = seg(deriveStatus(reports, events, [], NOW));
    expect(s.status).toBe("OPEN");
  });

  it("clears via a steward 'clear' report more recent than the closure", () => {
    const reports = [
      report({ id: "r1", reporterId: "alice", createdAt: ago(20) }),
      report({ id: "r2", reporterId: "bob", createdAt: ago(20) }),
      report({ id: "r3", reporterId: "steward-a", isSteward: true, kind: "clear", createdAt: ago(1) }),
    ];
    const s = seg(deriveStatus(reports, [], [], NOW));
    expect(s.status).toBe("OPEN");
  });

  it("does NOT clear when the clear predates the closure reports", () => {
    const reports = [
      report({ id: "clear", reporterId: "steward-a", isSteward: true, kind: "clear", createdAt: ago(40) }),
      report({ id: "r1", reporterId: "alice", createdAt: ago(10) }),
      report({ id: "r2", reporterId: "bob", createdAt: ago(5) }),
    ];
    const s = seg(deriveStatus(reports, [], [], NOW));
    expect(s.status).toBe("CLOSED");
  });

  it("times out: corroborated closure older than the window reverts to OPEN", () => {
    const stale = new Date(NOW.getTime() - (CORROBORATION_WINDOW_MS + 60_000)).toISOString();
    const reports = [
      report({ id: "r1", reporterId: "alice", createdAt: stale }),
      report({ id: "r2", reporterId: "bob", createdAt: stale }),
    ];
    const s = seg(deriveStatus(reports, [], [], NOW));
    expect(s.status).toBe("OPEN");
    expect(s.source).toBe("default");
  });
});

describe("deriveStatus — rule 6: manual steward override wins", () => {
  it("override to CLOSED beats an official OPEN world and records the reason", () => {
    const ov = override({ id: "o1", status: "CLOSED", reason: "Avalanche control" });
    const s = seg(deriveStatus([], [], [ov], NOW));
    expect(s.status).toBe("CLOSED");
    expect(s.source).toBe("override");
    expect(s.confidence).toBe("official");
    expect(s.reason).toBe("Avalanche control");
  });

  it("override to OPEN beats an official closure", () => {
    const events = [officialEvent({ id: "e1", kind: "closure" })];
    const ov = override({ id: "o1", status: "OPEN", reason: "Confirmed reopened on the ground" });
    const s = seg(deriveStatus([], events, [ov], NOW));
    expect(s.status).toBe("OPEN");
    expect(s.source).toBe("override");
    expect(s.reason).toBe("Confirmed reopened on the ground");
  });

  it("an expired override does not apply", () => {
    const ov = override({ id: "o1", status: "CLOSED", createdAt: ago(120), expiresAt: ago(60) });
    const s = seg(deriveStatus([], [], [ov], NOW));
    expect(s.status).toBe("OPEN");
    expect(s.source).not.toBe("override");
  });
});

describe("deriveStatus — rule 7: every status carries source, confidence, updatedAt", () => {
  it("populates the three provenance fields on every segment", () => {
    const result = deriveStatus([report({ id: "r1" })], [], [], NOW);
    for (const s of result.segments) {
      expect(s.source).toBeTruthy();
      expect(s.confidence).toBeTruthy();
      expect(s.updatedAt).toBe(NOW.toISOString());
    }
    expect(result.updatedAt).toBe(NOW.toISOString());
  });
});

describe("deriveStatus — corridor rollup", () => {
  it("takes the worst segment status as the corridor status", () => {
    const reports = [report({ id: "r1", segmentId: "whistler-pemberton", isSteward: true, reporterId: "sw" })];
    const result = deriveStatus(reports, [], [], NOW);
    expect(result.status).toBe("CLOSED");
    expect(seg(result, "whistler-pemberton").status).toBe("CLOSED");
    expect(seg(result, "horseshoe-bay-squamish").status).toBe("OPEN");
  });
});

describe("deriveStatus — determinism (rule: pure function)", () => {
  it("produces identical output for identical inputs", () => {
    const reports = [
      report({ id: "r1", reporterId: "alice", createdAt: ago(10) }),
      report({ id: "r2", reporterId: "bob", createdAt: ago(5) }),
    ];
    const a = deriveStatus(reports, [], [], NOW);
    const b = deriveStatus(reports, [], [], NOW);
    expect(a).toEqual(b);
  });

  it("does not mutate its input arrays", () => {
    const reports = [report({ id: "r1" })];
    const snapshot = JSON.parse(JSON.stringify(reports));
    deriveStatus(reports, [], [], NOW);
    expect(reports).toEqual(snapshot);
  });
});
