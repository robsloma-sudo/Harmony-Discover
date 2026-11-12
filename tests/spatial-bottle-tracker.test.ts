import { describe, expect, it } from 'vitest';
import { SpatialBottleTracker } from '../src/live/spatialBottleTracker';

const point = (x: number): { x: number; y: number; z: number } => ({ x, y: 0, z: -2 });

describe('persistent physical bottle tracking', () => {
  it('confirms a stable physical object after repeated strong geometry observations', () => {
    const tracker = new SpatialBottleTracker();
    const first = tracker.update([{ worldPoint: point(0), confidence: 0.92, geometryComplete: true }], 1000);
    const id = first.observed[0]!.physicalObjectId;
    expect(first.observed[0]?.state).toBe('potential');
    const second = tracker.update([{ worldPoint: point(0.04), confidence: 0.94, geometryComplete: true }], 1500);
    expect(second.observed[0]!.physicalObjectId).toBe(id);
    expect(second.observed[0]?.state).toBe('confirmed');
  });

  it('does not confirm incomplete or low-confidence geometry', () => {
    const tracker = new SpatialBottleTracker();
    const result = tracker.update([{ worldPoint: point(0), confidence: 0.99, geometryComplete: false }], 1000);
    expect(result.observed[0].state).toBe('potential');
    expect(result.observed[0].reason).toBe('incomplete_geometry');
  });

  it('preserves a confirmed physical identity during temporary occlusion', () => {
    const tracker = new SpatialBottleTracker({ occlusionGraceMs: 2500 });
    tracker.update([{ worldPoint: point(0), confidence: 0.9, geometryComplete: true }], 1000);
    const confirmed = tracker.update([{ worldPoint: point(0), confidence: 0.9, geometryComplete: true }], 1500);
    const id = confirmed.observed[0]!.physicalObjectId;
    const occluded = tracker.update([], 2300);
    expect(occluded.tracks[0].physicalObjectId).toBe(id);
    expect(occluded.tracks[0].state).toBe('occluded');
    const reacquired = tracker.update([{ worldPoint: point(0.03), confidence: 0.9, geometryComplete: true }], 2600);
    expect(reacquired.observed[0].physicalObjectId).toBe(id);
  });

  it('does not merge two separate bottles at different world positions', () => {
    const tracker = new SpatialBottleTracker();
    const result = tracker.update([
      { worldPoint: point(0), confidence: 0.9, geometryComplete: true, visualKey: 'same-label' },
      { worldPoint: point(0.8), confidence: 0.9, geometryComplete: true, visualKey: 'same-label' },
    ], 1000);
    expect(result.observed[0].physicalObjectId).not.toBe(result.observed[1].physicalObjectId);
  });

  it('does not associate a visually conflicting object even when spatially close', () => {
    const tracker = new SpatialBottleTracker();
    const first = tracker.update([{ worldPoint: point(0), confidence: 0.9, geometryComplete: true, visualKey: 'label-a' }], 1000);
    const next = tracker.update([{ worldPoint: point(0.01), confidence: 0.9, geometryComplete: true, visualKey: 'label-b' }], 1200);
    expect(next.observed[0]!.physicalObjectId).not.toBe(first.observed[0]!.physicalObjectId);
  });

  it('does not create phantom tracks when metric depth is unavailable', () => {
    const tracker = new SpatialBottleTracker();
    const invalid = { confidence: 0.9, geometryComplete: false, reason: 'insufficient_depth' as const };
    const first = tracker.update([invalid], 1000);
    const second = tracker.update([invalid], 1500);
    expect(first.observed).toEqual([null]);
    expect(second.observed).toEqual([null]);
    expect(second.tracks).toEqual([]);
  });

  it('does not count the same camera frame twice toward confirmation', () => {
    const tracker = new SpatialBottleTracker();
    const observation = { worldPoint: point(0), confidence: 0.9, geometryComplete: true };
    const first = tracker.update([observation], 1000);
    const duplicate = tracker.update([observation], 1000);
    expect(first.observed[0]?.state).toBe('potential');
    expect(duplicate.observed).toEqual([null]);
    expect(duplicate.tracks[0].state).toBe('potential');
    const nextFrame = tracker.update([observation], 1500);
    expect(nextFrame.observed[0]?.state).toBe('confirmed');
  });

  it('removes lost identities after the diagnostic retention window', () => {
    const tracker = new SpatialBottleTracker({ lostRetentionMs: 1000, occlusionGraceMs: 300 });
    tracker.update([{ worldPoint: point(0), confidence: 0.9, geometryComplete: true }], 1000);
    tracker.update([{ worldPoint: point(0), confidence: 0.9, geometryComplete: true }], 1100);
    const retained = tracker.update([], 1700);
    expect(retained.tracks).toHaveLength(1);
    expect(retained.tracks[0].state).toBe('occluded');
    const expired = tracker.update([], 2200);
    expect(expired.tracks).toHaveLength(0);
  });
});
