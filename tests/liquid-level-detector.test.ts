import { describe, expect, it } from 'vitest';
import { detectLiquidBoundaryCandidate, type PixelFrame } from '../src/services/liquidLevelDetector';

function horizontalScene(width = 80, height = 120, boundary = 70): PixelFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const liquid = y >= boundary;
      data[offset] = liquid ? 35 : 185;
      data[offset + 1] = liquid ? 95 : 190;
      data[offset + 2] = liquid ? 145 : 195;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}


function curvedScene(width = 80, height = 120): PixelFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edgeDistance = Math.abs((x - (width - 1) / 2) / ((width - 1) / 2));
      const boundary = 58 + Math.round(13 * edgeDistance * edgeDistance);
      const liquid = y >= boundary;
      const offset = (y * width + x) * 4;
      data[offset] = liquid ? 35 : 185;
      data[offset + 1] = liquid ? 95 : 190;
      data[offset + 2] = liquid ? 145 : 195;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

describe('detectLiquidBoundaryCandidate', () => {
  it('finds a horizontal transition supported across the bottle interior', () => {
    const result = detectLiquidBoundaryCandidate(horizontalScene(), { x: 8, y: 4, width: 64, height: 112 });
    expect(result.status).toBe('candidate');
    if (result.status === 'candidate') {
      expect(result.normalizedHeight).toBeGreaterThan(0.35);
      expect(result.normalizedHeight).toBeLessThan(0.55);
      expect(result.columnSupport).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('recognizes a curved meniscus instead of forcing a flat line', () => {
    const result = detectLiquidBoundaryCandidate(curvedScene(), { x: 8, y: 4, width: 64, height: 112 });
    expect(result.status).toBe('candidate');
    if (result.status === 'candidate') {
      expect(result.boundaryShape).toBe('curved');
      expect(Math.abs(result.curvature)).toBeGreaterThan(0.008);
    }
  });

  it('abstains on a uniform crop instead of inventing a liquid line', () => {
    const frame = horizontalScene();
    frame.data.fill(120);
    const result = detectLiquidBoundaryCandidate(frame, { x: 8, y: 4, width: 64, height: 112 });
    expect(result.status).toBe('insufficient_evidence');
  });

  it('rejects invalid image geometry', () => {
    const result = detectLiquidBoundaryCandidate(horizontalScene(), { x: 500, y: 500, width: 10, height: 10 });
    expect(result.status).toBe('insufficient_evidence');
  });

  it('ignores transitions inside a supplied label/occlusion band', () => {
    const frame = horizontalScene();
    const result = detectLiquidBoundaryCandidate(frame, {
      x: 8, y: 4, width: 64, height: 112,
    }, { occlusionBands: [{ top: 0.45, bottom: 0.65 }] });
    expect(result.status).toBe('insufficient_evidence');
  });
});
