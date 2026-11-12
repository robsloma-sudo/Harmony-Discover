import { describe, expect, it } from 'vitest';
import { contourSegments, mapNormalizedPointsToCover } from '../src/live/contourGeometry';

describe('contour overlay geometry', () => {
  it('converts normalized polygon edges into camera-space line segments', () => {
    const segments = contourSegments([
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.75 },
      { x: 0.25, y: 0.75 },
    ], 400, 800);
    expect(segments).toHaveLength(4);
    expect(segments[0]?.length).toBeCloseTo(200);
    expect(segments[0]?.angle).toBeCloseTo(0);
    expect(segments[1]?.length).toBeCloseTo(400);
    expect(segments[1]?.angle).toBeCloseTo(Math.PI / 2);
  });

  it('closes the polygon and ignores duplicate zero-length points', () => {
    const segments = contourSegments([
      { x: 0.1, y: 0.1 },
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.5, y: 0.9 },
    ], 100, 100);
    expect(segments).toHaveLength(3);
  });

  it('maps source mask points through the same centered cover crop as the camera preview', () => {
    const mapped = mapNormalizedPointsToCover([
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 0.5 },
    ], 400, 300, 300, 600);
    expect(mapped[0]?.x).toBeCloseTo(-5 / 6);
    expect(mapped[1]?.x).toBeCloseTo(0.5);
    expect(mapped[2]?.x).toBeCloseTo(11 / 6);
    expect(mapped[1]?.y).toBeCloseTo(0.5);
  });

  it('preserves normalized coordinates when source and viewport aspect ratios match', () => {
    const points = [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 }];
    expect(mapNormalizedPointsToCover(points, 400, 800, 300, 600)).toEqual(points);
  });

  it('returns no segments before layout or for insufficient points', () => {
    expect(contourSegments([{ x: 0, y: 0 }, { x: 1, y: 1 }], 100, 100)).toEqual([]);
    expect(contourSegments([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], 0, 100)).toEqual([]);
  });
});
