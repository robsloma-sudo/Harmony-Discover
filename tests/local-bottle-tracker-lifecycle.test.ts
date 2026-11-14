import { describe, expect, it } from 'vitest';
import { LocalBottleTracker } from '../src/live/localBottleTracker';

const bottle = (x: number) => ({
  bounds: { x, y: 0.3, width: 0.14, height: 0.3 },
  confidence: 0.95,
});

describe('local bottle track lifecycle', () => {
  it('preserves identity through a short detector miss', () => {
    const tracker = new LocalBottleTracker();
    const first = tracker.update([bottle(0.35)], 1_000)[0]!;
    tracker.update([], 1_200);
    const reacquired = tracker.update([bottle(0.36)], 1_400)[0]!;
    expect(reacquired.trackId).toBe(first.trackId);
  });

  it('does not reuse a physical track after a long absence', () => {
    const tracker = new LocalBottleTracker();
    const first = tracker.update([bottle(0.35)], 1_000)[0]!;
    tracker.update([], 5_000);
    tracker.update([], 10_000);
    const replacement = tracker.update([bottle(0.35)], 11_000)[0]!;
    expect(replacement.trackId).not.toBe(first.trackId);
  });
});
