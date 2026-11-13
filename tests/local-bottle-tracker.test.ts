import { describe, expect, it } from 'vitest';
import { LocalBottleTracker } from '../src/live/localBottleTracker';

const proposal = (x = 0.2, confidence = 0.91) => ({
  bounds: { x, y: 0.1, width: 0.12, height: 0.55 },
  confidence,
  contour: [{ x, y: 0.1 }, { x: x + 0.12, y: 0.1 }, { x: x + 0.12, y: 0.65 }, { x, y: 0.65 }],
});

describe('independent local bottle tracks', () => {
  it('does not publish one-frame proposals and confirms a stable candidate on the second observation', () => {
    const tracker = new LocalBottleTracker();
    expect(tracker.update([proposal()], 1000)).toEqual([]);
    const confirmed = tracker.update([proposal(0.205)], 3200);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.trackId).toBeGreaterThanOrEqual(1_000_000);
    expect(confirmed[0]?.hits).toBe(2);
  });

  it('keeps separate IDs for two spatially distinct bottles', () => {
    const tracker = new LocalBottleTracker();
    tracker.update([proposal(0.1), proposal(0.65)], 1000);
    const confirmed = tracker.update([proposal(0.105), proposal(0.655)], 3200);
    expect(confirmed).toHaveLength(2);
    expect(new Set(confirmed.map(item => item.trackId)).size).toBe(2);
  });

  it('rejects low-confidence and malformed proposals', () => {
    const tracker = new LocalBottleTracker();
    expect(tracker.update([proposal(0.2, 0.4), { ...proposal(), bounds: { x: 1.2, y: 0, width: 0.2, height: 0.2 } }], 1000)).toEqual([]);
  });

  it('preserves an ID through one missed observation and expires stale tracks', () => {
    const tracker = new LocalBottleTracker();
    tracker.update([proposal()], 1000);
    const first = tracker.update([proposal()], 3200)[0]!;
    expect(tracker.update([], 5400)[0]?.trackId).toBe(first.trackId);
    expect(tracker.update([], 12_000)).toEqual([]);
  });

  it('resets IDs and tracked state when the camera session is restarted', () => {
    const tracker = new LocalBottleTracker();
    tracker.update([proposal()], 1000);
    tracker.update([proposal()], 3200);
    tracker.reset();
    expect(tracker.update([], 4000)).toEqual([]);
    expect(tracker.update([proposal()], 5000)).toEqual([]);
    expect(tracker.update([proposal()], 7000)[0]?.trackId).toBe(1_000_000);
  });
});
