import { describe, expect, it } from 'vitest';
import { LocalBottleTracker } from '../src/live/localBottleTracker';

const proposal = (x = 0.2, confidence = 0.91) => ({
  bounds: { x, y: 0.1, width: 0.12, height: 0.55 },
  confidence,
  contour: [{ x, y: 0.1 }, { x: x + 0.12, y: 0.1 }, { x: x + 0.12, y: 0.65 }, { x, y: 0.65 }],
});

describe('independent local bottle tracks', () => {
  it('publishes a strong first-frame proposal immediately, then preserves its ID', () => {
    const tracker = new LocalBottleTracker();
    const provisional = tracker.update([proposal()], 1000);
    expect(provisional).toHaveLength(1);
    expect(provisional[0]?.trackId).toBeGreaterThanOrEqual(1_000_000);
    expect(provisional[0]?.hits).toBe(1);
    const confirmed = tracker.update([proposal(0.205)], 2000);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.trackId).toBe(provisional[0]?.trackId);
    expect(confirmed[0]?.hits).toBe(2);
  });

  it('waits for a second observation before showing a weaker proposal', () => {
    const tracker = new LocalBottleTracker();
    expect(tracker.update([proposal(0.2, 0.65)], 1000)).toEqual([]);
    const confirmed = tracker.update([proposal(0.205, 0.65)], 2000);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.hits).toBe(2);
  });

  it('keeps separate IDs for two spatially distinct bottles', () => {
    const tracker = new LocalBottleTracker();
    const first = tracker.update([proposal(0.1), proposal(0.65)], 1000);
    expect(first).toHaveLength(2);
    const confirmed = tracker.update([proposal(0.105), proposal(0.655)], 2000);
    expect(confirmed).toHaveLength(2);
    expect(new Set(confirmed.map(item => item.trackId)).size).toBe(2);
  });

  it('rejects low-confidence and malformed proposals', () => {
    const tracker = new LocalBottleTracker();
    expect(tracker.update([proposal(0.2, 0.4), { ...proposal(), bounds: { x: 1.2, y: 0, width: 0.2, height: 0.2 } }], 1000)).toEqual([]);
  });

  it('holds a confirmed box through one missed frame, then hides it and expires the track', () => {
    const tracker = new LocalBottleTracker();
    tracker.update([proposal()], 1000);
    const [confirmed] = tracker.update([proposal()], 2000);
    expect(confirmed).toBeDefined();
    const [held] = tracker.update([], 3000);
    expect(held?.trackId).toBe(confirmed?.trackId);
    expect(held?.bounds).toEqual(confirmed?.bounds);
    expect(tracker.update([], 4000)).toEqual([]);
    expect(tracker.update([], 11_000)).toEqual([]);
  });

  it('resets IDs and tracked state when the camera session is restarted', () => {
    const tracker = new LocalBottleTracker();
    tracker.update([proposal()], 1000);
    tracker.update([proposal()], 2000);
    tracker.reset();
    expect(tracker.update([], 3000)).toEqual([]);
    expect(tracker.update([proposal()], 4000)[0]?.trackId).toBe(1_000_000);
  });

  it('keeps up to 24 spatially distinct bottles visible from one strong shelf observation', () => {
    const tracker = new LocalBottleTracker();
    const shelf = Array.from({ length: 15 }, (_, index) => ({
      bounds: { x: 0.01 + index * 0.065, y: 0.1, width: 0.04, height: 0.55 },
      confidence: 0.91,
    }));
    const firstFrame = tracker.update(shelf, 1000);
    expect(firstFrame).toHaveLength(15);
    expect(new Set(firstFrame.map(item => item.trackId)).size).toBe(15);
  });
});
