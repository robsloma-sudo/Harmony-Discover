import { describe, expect, it } from 'vitest';
import { LocalBottleTracker } from '../src/live/localBottleTracker';
import { shelfScanAnnotations } from './fixtures/scanner-shelf-2026-11-13';

describe('shelf-scan visual annotation fixture', () => {
  it('contains unique physical object IDs within each annotated frame', () => {
    for (const frame of shelfScanAnnotations) {
      const ids = frame.objects.map(object => object.objectId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('keeps every approximate physical-object bound within normalized frame coordinates', () => {
    for (const frame of shelfScanAnnotations) {
      for (const object of frame.objects) {
        const { x, y, width, height } = object.bounds;
        expect([x, y, width, height].every(Number.isFinite)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(width).toBeGreaterThan(0);
        expect(height).toBeGreaterThan(0);
        expect(x + width).toBeLessThanOrEqual(1.001);
        expect(y + height).toBeLessThanOrEqual(1.001);
      }
    }
  });

  it('documents the same clearly recognizable objects across the early frames', () => {
    const early = shelfScanAnnotations.filter(frame => frame.timestampSeconds === 5 || frame.timestampSeconds === 9);
    expect(early).toHaveLength(2);
    for (const objectId of ['tall-yellow-container', 'left-squat-glass-bottle', 'green-round-logo-bottle']) {
      expect(early[0]!.objects.some(object => object.objectId === objectId)).toBe(true);
      expect(early[1]!.objects.some(object => object.objectId === objectId)).toBe(true);
    }
  });

  it('replays annotated early-frame geometry without merging adjacent physical objects', () => {
    const tracker = new LocalBottleTracker();
    const first = shelfScanAnnotations.find(frame => frame.timestampSeconds === 5)!;
    const second = shelfScanAnnotations.find(frame => frame.timestampSeconds === 9)!;
    const toProposals = (frame: typeof first) => frame.objects.map(object => ({
      bounds: object.bounds,
      confidence: 0.95
    }));

    const firstCandidates = tracker.update(toProposals(first), 1000);
    const secondCandidates = tracker.update(toProposals(second), 1400);

    // Three clearly visible physical objects must remain separately represented.
    expect(firstCandidates.length).toBeGreaterThanOrEqual(3);
    expect(secondCandidates.length).toBeGreaterThanOrEqual(3);
    expect(new Set(secondCandidates.map(candidate => candidate.trackId)).size).toBe(secondCandidates.length);
  });
});
