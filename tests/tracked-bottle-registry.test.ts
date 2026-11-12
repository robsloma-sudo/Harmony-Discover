import { describe, expect, it } from 'vitest';
import { mergeTrackedBottleCandidates, type TrackedBottleRecord } from '../src/live/trackedBottleRegistry';

type Bottle = { brand: string; product: string };
const bottle: Bottle = { brand: 'Example Distillery', product: 'Small Batch' };
const prior: TrackedBottleRecord<Bottle> = {
  trackId: 12, x: 0.1, y: 0.2, width: 0.2, height: 0.6, confidence: 0.9, bottle,
};

describe('tracked bottle metadata registry', () => {
  it('keeps bottle identity while local geometry moves without a new read', () => {
    const result = mergeTrackedBottleCandidates([prior], [
      { trackId: 12, x: 0.14, y: 0.21, width: 0.2, height: 0.6, confidence: 0.72 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.bottle).toBe(bottle);
    expect(result[0]?.x).toBe(0.14);
  });

  it('preserves a mask contour while local tracking updates only the box', () => {
    const contour = [{ x: 0.2, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.3, y: 0.8 }];
    const withContour = { ...prior, contour };
    const result = mergeTrackedBottleCandidates([withContour], [
      { trackId: 12, x: 0.12, y: 0.22, width: 0.2, height: 0.6, confidence: 0.7 },
    ]);
    expect(result[0]?.contour).toBe(contour);
  });

  it('replaces metadata when a fresh read arrives for the same track', () => {
    const updated = { brand: 'Example Distillery', product: 'Single Barrel' };
    const result = mergeTrackedBottleCandidates([prior], [
      { trackId: 12, x: 0.1, y: 0.2, width: 0.2, height: 0.6, confidence: 0.95, bottle: updated },
    ]);
    expect(result[0]?.bottle).toBe(updated);
  });

  it('drops records after the tracker no longer emits their identity', () => {
    expect(mergeTrackedBottleCandidates([prior], [])).toEqual([]);
  });

  it('does not attach stale bottle metadata to a new physical track ID', () => {
    const result = mergeTrackedBottleCandidates([prior], [
      { trackId: 13, x: 0.1, y: 0.2, width: 0.2, height: 0.6, confidence: 0.8 },
    ]);
    expect(result).toEqual([]);
  });
});
