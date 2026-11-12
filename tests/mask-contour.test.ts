import { describe, expect, it } from 'vitest';
import { extractMaskContour } from '../src/live/maskContour';

function binaryMask(width: number, height: number, pixels: Array<[number, number]>): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const [x, y] of pixels) mask[y * width + x] = 1;
  return mask;
}

describe('mask-derived bottle contours', () => {
  it('extracts the real foreground boundary instead of a bounding rectangle', () => {
    const pixels: Array<[number, number]> = [];
    for (let y = 1; y <= 4; y++) for (let x = 1; x <= 3; x++) pixels.push([x, y]);
    const contour = extractMaskContour(binaryMask(6, 6, pixels), 6, 6);
    expect(contour).not.toBeNull();
    expect(contour?.points).toHaveLength(4);
    expect(contour?.area).toBeCloseTo(12 / 36, 5);
    expect(contour?.bounds.x).toBeCloseTo(1 / 6, 5);
    expect(contour?.bounds.width).toBeCloseTo(3 / 6, 5);
    expect(contour?.bounds.height).toBeCloseTo(4 / 6, 5);
  });

  it('maps a crop-local mask into normalized camera coordinates', () => {
    const pixels: Array<[number, number]> = [];
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 2; x++) pixels.push([x, y]);
    const contour = extractMaskContour(binaryMask(4, 5, pixels), 4, 5, {
      bounds: { x: 0.2, y: 0.1, width: 0.4, height: 0.7 },
    });
    expect(contour?.bounds.x).toBeCloseTo(0.3, 5);
    expect(contour?.bounds.y).toBeCloseTo(0.24, 5);
    expect(contour?.bounds.width).toBeCloseTo(0.2, 5);
    expect(contour?.bounds.height).toBeCloseTo(0.42, 5);
  });

  it('chooses the largest connected external mask contour', () => {
    const mask = binaryMask(8, 8, [
      [0, 0],
      [3, 2], [4, 2], [5, 2],
      [3, 3], [4, 3], [5, 3],
      [3, 4], [4, 4], [5, 4],
    ]);
    const contour = extractMaskContour(mask, 8, 8);
    expect(contour?.area).toBeCloseTo(9 / 64, 5);
    expect(contour?.bounds.x).toBeCloseTo(3 / 8, 5);
  });

  it('rejects empty, malformed, and tiny masks', () => {
    expect(extractMaskContour(new Uint8Array(36), 6, 6)).toBeNull();
    expect(extractMaskContour(new Uint8Array(4), 6, 6)).toBeNull();
    expect(extractMaskContour(binaryMask(100, 100, [[50, 50]]), 100, 100)).toBeNull();
  });

  it('respects confidence threshold and maximum point budget', () => {
    const mask = new Float32Array(20 * 20);
    for (let y = 2; y < 18; y++) for (let x = 4; x < 16; x++) mask[y * 20 + x] = 0.9;
    const contour = extractMaskContour(mask, 20, 20, { threshold: 0.8, maxPoints: 4 });
    expect(contour?.points.length).toBe(4);
    expect(contour?.area).toBeCloseTo((12 * 16) / 400, 5);
  });
});
