import { describe, expect, it } from 'vitest';
import { assessLiquidOpticalVisibility } from '../src/services/liquidOptics';
import type { PixelFrame } from '../src/services/liquidLevelDetector';

function frame(fill: (x: number, y: number) => [number, number, number]): PixelFrame {
  const width = 80, height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    const [r, g, b] = fill(x, y);
    data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = 255;
  }
  return { width, height, data };
}

describe('assessLiquidOpticalVisibility', () => {
  const bounds = { x: 5, y: 3, width: 70, height: 114 };
  it('rejects a crop dominated by clipped specular highlights', () => {
    const result = assessLiquidOpticalVisibility(frame(() => [255, 255, 255]), bounds);
    expect(result.status).toBe('unobservable');
    expect(result.reason).toBe('severe_specular_glare');
  });
  it('rejects an almost-black crop', () => {
    const result = assessLiquidOpticalVisibility(frame(() => [3, 4, 3]), bounds);
    expect(result.status).toBe('unobservable');
    expect(result.reason).toBe('underexposed_or_opaque_crop');
  });
  it('accepts a crop with a visible horizontal optical transition', () => {
    const result = assessLiquidOpticalVisibility(frame((_x, y) => y < 60 ? [185, 190, 195] : [35, 95, 145]), bounds);
    expect(result.status).toBe('observable');
    expect(result.score).toBeGreaterThan(0.55);
  });
});
