import { describe, expect, it } from 'vitest';
import { LocalBottleTracker } from '../src/live/localBottleTracker';

const p = (x: number, y: number, width: number, height: number, confidence = 0.9) => ({ bounds: { x, y, width, height }, confidence });

describe('neck stickers never move the box (widest part wins)', () => {
  it('keeps the whole-bottle box when only the neck is detected for a frame', () => {
    const tracker = new LocalBottleTracker();
    const body = p(0.3, 0.1, 0.2, 0.8);
    tracker.update([body], 1000);
    tracker.update([body], 1200);
    // Only the neck sticker is found this frame: narrow, upper part of the bottle.
    const after = tracker.update([p(0.34, 0.1, 0.12, 0.38)], 1400);
    expect(after).toHaveLength(1);
    expect(after[0]!.bounds.width).toBeCloseTo(0.2, 2);
    expect(after[0]!.bounds.height).toBeCloseTo(0.8, 2);
  });
});
