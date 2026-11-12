import { describe, expect, it } from 'vitest';
import { contourSegments } from '../src/live/contourGeometry';

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

  it('returns no segments before layout or for insufficient points', () => {
    expect(contourSegments([{ x: 0, y: 0 }, { x: 1, y: 1 }], 100, 100)).toEqual([]);
    expect(contourSegments([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], 0, 100)).toEqual([]);
  });
});
