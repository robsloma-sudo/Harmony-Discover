import { describe, expect, it } from 'vitest';
import { calculateLabelCrop } from '../src/live/labelCrop';

describe('original-resolution label crop geometry', () => {
  it('maps normalized label bounds into source pixels with padding', () => {
    const crop = calculateLabelCrop({ x0: 0.25, y0: 0.2, x1: 0.55, y1: 0.6 }, 4000, 3000);
    expect(crop).not.toBeNull();
    expect(crop?.sx).toBeLessThan(1000);
    expect(crop?.sy).toBeLessThan(600);
    expect(crop?.sw).toBeGreaterThan(1200);
    expect(crop?.sh).toBeGreaterThan(1200);
  });

  it('preserves native crop pixels when the label is already large enough', () => {
    const crop = calculateLabelCrop({ x0: 0.1, y0: 0.1, x1: 0.8, y1: 0.9 }, 2000, 2000);
    expect(crop?.outputWidth).toBe(crop?.sw);
    expect(crop?.outputHeight).toBe(crop?.sh);
  });

  it('caps output size and limits upscaling for small labels', () => {
    const crop = calculateLabelCrop({ x0: 0.4, y0: 0.4, x1: 0.45, y1: 0.5 }, 1000, 1000);
    expect(Math.max(crop!.outputWidth, crop!.outputHeight)).toBeLessThanOrEqual(2048);
    expect(crop!.outputWidth / crop!.sw).toBeLessThanOrEqual(2);
  });

  it('rejects malformed and inverted normalized boxes', () => {
    expect(calculateLabelCrop({ x0: 0.8, y0: 0.2, x1: 0.3, y1: 0.7 }, 1200, 800)).toBeNull();
    expect(calculateLabelCrop({ x0: -0.1, y0: 0.2, x1: 0.3, y1: 0.7 }, 1200, 800)).toBeNull();
    expect(calculateLabelCrop({ x0: 0, y0: 0, x1: 1, y1: 1 }, 0, 800)).toBeNull();
  });
});
