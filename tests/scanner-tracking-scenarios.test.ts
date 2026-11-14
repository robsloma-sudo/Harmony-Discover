import { describe, expect, it } from 'vitest';
import { LocalBottleTracker } from '../src/live/localBottleTracker';

const proposal = (x: number, y = 0.3, width = 0.14, height = 0.3) => ({
  bounds: { x, y, width, height },
  confidence: 0.95,
});

describe('scanner physical tracking scenarios', () => {
  it('keeps two adjacent, visually identical bottle proposals as separate tracks', () => {
    const tracker = new LocalBottleTracker();
    const first = tracker.update([proposal(0.20), proposal(0.39)], 1000);
    expect(first).toHaveLength(2);
    expect(new Set(first.map(item => item.trackId)).size).toBe(2);

    // Both objects move with the camera. Their product identity is deliberately
    // absent: physical separation must be sufficient to preserve two tracks.
    const moved = tracker.update([proposal(0.24), proposal(0.43)], 1100);
    expect(moved).toHaveLength(2);
    expect(new Set(moved.map(item => item.trackId)).size).toBe(2);
    expect(moved.map(item => item.trackId)).toEqual(first.map(item => item.trackId));
  });

  it('preserves track IDs through a modest camera pan', () => {
    const tracker = new LocalBottleTracker();
    const first = tracker.update([proposal(0.18), proposal(0.58)], 1000);
    const panned = tracker.update([proposal(0.23), proposal(0.63)], 1200);

    expect(panned.map(item => item.trackId)).toEqual(first.map(item => item.trackId));
  });

  it('recovers a temporarily occluded bottle without changing its track ID', () => {
    const tracker = new LocalBottleTracker();
    const first = tracker.update([proposal(0.20), proposal(0.60)], 1000);
    const partiallyOccluded = tracker.update([proposal(0.22)], 1200);
    expect(partiallyOccluded).toHaveLength(2);

    const returned = tracker.update([proposal(0.23), proposal(0.60)], 1400);
    expect(returned).toHaveLength(2);
    expect(returned.map(item => item.trackId)).toEqual(first.map(item => item.trackId));
  });

  it('characterizes the current stale-track reuse after a bottle leaves and another enters the same position', () => {
    const tracker = new LocalBottleTracker();
    const original = tracker.update([proposal(0.35)], 1000)[0]!;
    tracker.update([], 5000);
    tracker.update([], 10000);

    // Current implementation retains internal tracks for 30s and can assign
    // the old ID to a new physical bottle at the same location. This is a
    // known lifecycle defect; the expectation should be inverted when a
    // generation-aware retirement policy is implemented.
    const replacement = tracker.update([proposal(0.35)], 11000)[0]!;
    expect(replacement.trackId).toBe(original.trackId);
  });
});
