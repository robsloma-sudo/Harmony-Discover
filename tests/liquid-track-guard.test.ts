import { describe, expect, it } from 'vitest';
import { LiquidTrackGuard } from '../src/live/liquidTrackGuard';

describe('late liquid results stay on the right bottle', () => {
  it('accepts a result for an unchanged track', () => {
    const guard = new LiquidTrackGuard();
    guard.stamp(100, [-1, -2]);
    expect(guard.accepts(100, -1)).toBe(true);
  });

  it('rejects a result when the track was re-found or merged after the frame was sent', () => {
    const guard = new LiquidTrackGuard();
    guard.stamp(100, [-1, -2]);
    guard.bump(-1);
    expect(guard.accepts(100, -1)).toBe(false);
    expect(guard.accepts(100, -2)).toBe(true);
    guard.stamp(200, [-1]);
    expect(guard.accepts(200, -1)).toBe(true);
  });

  it('rejects results for frames it never sent, tracks not in the frame, and after a reset', () => {
    const guard = new LiquidTrackGuard(2);
    guard.stamp(100, [-1]);
    expect(guard.accepts(999, -1)).toBe(false);
    expect(guard.accepts(100, -7)).toBe(false);
    guard.stamp(200, [-1]); guard.stamp(300, [-1]);
    expect(guard.accepts(100, -1)).toBe(false); // too old, forgotten
    guard.clear();
    expect(guard.accepts(300, -1)).toBe(false);
  });
});
