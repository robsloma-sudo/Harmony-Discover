import { describe, expect, it } from 'vitest';
import { shelfScanAnnotations, shelfScanCoordinateSpace } from './fixtures/scanner-shelf-2026-11-13';

describe('shelf-scan visual annotation fixture', () => {
  it('declares the source coordinate space so screen bounds are not mistaken for camera bounds', () => {
    expect(shelfScanCoordinateSpace).toBe('full-screen-recording');
  });

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

  it('does not feed full-screen annotations directly into the camera-space tracker', () => {
    // The recording includes app chrome and a camera viewport. Its full-screen
    // bounds have not been transformed into the camera frame's normalized space.
    // A tracker replay here would compare incompatible coordinate systems and
    // could pass or fail for the wrong reason. Tracker behavior is covered by
    // the isolated synthetic scenarios in scanner-tracking-scenarios.test.ts.
    expect(shelfScanCoordinateSpace).not.toBe('camera-frame');
  });
});
