import { describe, expect, it } from 'vitest';
import { rgbaToGrayscale, trackBoxesWithOpticalFlow } from '../src/live/browserOpticalFlow';

function texturedFrame(width: number, height: number, shiftX = 0, shiftY = 0): Uint8Array {
  const frame = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = x - shiftX, sy = y - shiftY;
    frame[y * width + x] = (Math.sin(sx * 0.31) * 38 + Math.cos(sy * 0.23) * 34
      + Math.sin((sx + sy) * 0.17) * 28 + 128) | 0;
  }
  return frame;
}

describe('browser sparse optical flow', () => {
  it('moves a bottle box with a textured scene between detector frames', () => {
    const width = 160, height = 120;
    const previous = texturedFrame(width, height);
    const current = texturedFrame(width, height, 2, 1);
    const [result] = trackBoxesWithOpticalFlow(previous, current, width, height, [
      { x: 0.25, y: 0.2, width: 0.3, height: 0.55 },
    ]);
    expect(result).not.toBeNull();
    expect(result!.box.x).toBeGreaterThan(0.25);
    expect(result!.box.y).toBeGreaterThan(0.2);
    expect(result!.trackedPoints).toBeGreaterThanOrEqual(3);
  });

  it('returns null for a textureless region rather than inventing motion', () => {
    const width = 80, height = 80;
    const flat = new Uint8Array(width * height).fill(120);
    expect(trackBoxesWithOpticalFlow(flat, flat, width, height, [
      { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
    ])[0]).toBeNull();
  });

  it('converts camera pixels to a compact grayscale frame', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    expect(Array.from(rgbaToGrayscale(rgba, 2, 1))).toEqual([76, 150]);
  });
});
