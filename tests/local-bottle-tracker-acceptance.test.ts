import { describe, expect, it } from "vitest";
import { LocalBottleTracker, removeNestedBottleProposals, type LocalBottleProposal } from "../src/live/localBottleTracker";

const proposal = (x: number, confidence = 0.9, width = 0.2, height = 0.7): LocalBottleProposal => ({
  bounds: { x, y: 0.15, width, height },
  confidence,
});

describe("local bottle tracking acceptance", () => {
  it("publishes a strong first-frame bottle proposal immediately", () => {
    const tracker = new LocalBottleTracker();
    const [track] = tracker.update([proposal(0.2, 0.8)], 1_000);
    expect(track).toMatchObject({ hits: 1, confidence: 0.8 });
  });

  it("requires a second observation before publishing a weaker proposal", () => {
    const tracker = new LocalBottleTracker();
    expect(tracker.update([proposal(0.2, 0.65)], 1_000)).toHaveLength(0);
    const [track] = tracker.update([proposal(0.205, 0.65)], 2_000);
    expect(track).toMatchObject({ hits: 2 });
  });

  it("keeps the same track ID through one missed detector pass", () => {
    const tracker = new LocalBottleTracker();
    const [first] = tracker.update([proposal(0.2)], 1_000);
    const [retained] = tracker.update([], 2_000);
    expect(retained?.trackId).toBe(first?.trackId);
    const [reacquired] = tracker.update([proposal(0.21)], 3_000);
    expect(reacquired?.trackId).toBe(first?.trackId);
    expect(reacquired?.hits).toBe(2);
  });

  it("does not keep stale boxes visible after the short visibility window", () => {
    const tracker = new LocalBottleTracker();
    tracker.update([proposal(0.2)], 1_000);
    expect(tracker.update([], 10_001)).toHaveLength(0);
  });

  it("resets track identity when the camera session is reset", () => {
    const tracker = new LocalBottleTracker();
    const [first] = tracker.update([proposal(0.2)], 1_000);
    tracker.reset();
    const [afterReset] = tracker.update([proposal(0.2)], 2_000);
    expect(afterReset?.trackId).not.toBe(first?.trackId);
  });

  it("removes a nested cork/neck fragment but preserves a separate bottle", () => {
    const proposals = [
      proposal(0.2, 0.9, 0.2, 0.7),
      { bounds: { x: 0.245, y: 0.17, width: 0.11, height: 0.16 }, confidence: 0.95 },
      proposal(0.58, 0.88, 0.18, 0.68),
    ];
    const result = removeNestedBottleProposals(proposals);
    expect(result).toHaveLength(2);
    expect(result.map(item => item.bounds.x)).toEqual([0.2, 0.58]);
  });
});
