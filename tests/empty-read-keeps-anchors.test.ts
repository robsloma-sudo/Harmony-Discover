import { describe, expect, it } from "vitest";
import { emptyCandidatesAction } from "../src/live/worldAnchorFramePolicy";
import { SpatialBottleTracker } from "../src/live/spatialBottleTracker";

const meters = (timestamp: number) => ({ unit: "meters", timestamp });

describe("empty candidate lists", () => {
  it("resets world anchors only when the scanner ends the session", () => {
    expect(emptyCandidatesAction({ reset: true })).toBe("reset");
    expect(emptyCandidatesAction({ reset: true, depthFrame: meters(5) })).toBe("reset");
  });

  it("treats a metric-depth frame with no bottles as one miss", () => {
    expect(emptyCandidatesAction({ depthFrame: meters(5) })).toBe("miss");
    expect(emptyCandidatesAction({ source: "cloud", depthFrame: meters(5) })).toBe("miss");
  });

  it("only clears boxes for routine empties, local frames and relative depth", () => {
    expect(emptyCandidatesAction({})).toBe("clear");
    expect(emptyCandidatesAction({ source: "local", depthFrame: meters(5) })).toBe("clear");
    expect(emptyCandidatesAction({ depthFrame: { unit: "relative", timestamp: 5 } })).toBe("clear");
    expect(emptyCandidatesAction({ depthFrame: { unit: "meters", timestamp: Number.NaN } })).toBe("clear");
  });
});

describe("a single empty read no longer erases 3D memory", () => {
  const options = { confirmationHits: 2, occlusionGraceMs: 3000, lostRetentionMs: 30000 };
  const bottle = { worldPoint: { x: 0.1, y: 0, z: -1 }, confidence: 0.9, geometryComplete: true };

  it("keeps a confirmed bottle (same ID) through one empty read and reacquires it", () => {
    const tracker = new SpatialBottleTracker(options);
    tracker.update([bottle], 1000);
    const confirmed = tracker.update([bottle], 2000).observed[0]!;
    expect(confirmed.state).toBe("confirmed");

    const afterMiss = tracker.update([], 3000).tracks; // the empty read, counted once as a miss
    expect(afterMiss).toHaveLength(1);
    expect(afterMiss[0]!.state).toBe("occluded");

    const back = tracker.update([bottle], 4000).observed[0]!;
    expect(back.physicalObjectId).toBe(confirmed.physicalObjectId);
  });

  it("still drops a bottle that stays missing past its retention", () => {
    const tracker = new SpatialBottleTracker(options);
    tracker.update([bottle], 1000);
    tracker.update([bottle], 2000);
    tracker.update([], 3000);
    expect(tracker.update([], 2000 + 30001).tracks).toHaveLength(0);
  });
});
