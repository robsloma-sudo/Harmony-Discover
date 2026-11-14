import { describe, expect, it } from 'vitest';
import { getObjectFitCoverCrop } from '../src/live/cameraCoverCrop';

describe('camera object-fit cover crop', () => {
  it('crops the horizontal edges of a landscape source in a portrait viewport', () => {
    const crop = getObjectFitCoverCrop(1920, 1080, 390, 844);
    expect(crop?.x).toBeCloseTo(710.4739336492892);
    expect(crop?.y).toBe(0);
    expect(crop?.width).toBeCloseTo(499.0521327014218);
    expect(crop?.height).toBe(1080);
  });

  it('crops the vertical edges of a portrait source in a landscape viewport', () => {
    const crop = getObjectFitCoverCrop(1080, 1920, 844, 390);
    expect(crop?.x).toBe(0);
    expect(crop?.width).toBe(1080);
    expect(crop?.height).toBeCloseTo(499.05213270142184);
    expect(crop?.y).toBeCloseTo(710.473933649289);
  });

  it('keeps the full frame when source and viewport aspect ratios match', () => {
    expect(getObjectFitCoverCrop(1280, 720, 640, 360)).toEqual({
      x: 0, y: 0, width: 1280, height: 720,
    });
  });

  it('rejects invalid dimensions rather than generating non-finite crop values', () => {
    expect(getObjectFitCoverCrop(0, 1080, 390, 844)).toBeNull();
    expect(getObjectFitCoverCrop(1920, Number.NaN, 390, 844)).toBeNull();
  });
});
