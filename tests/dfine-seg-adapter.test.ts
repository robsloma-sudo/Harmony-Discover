import { describe, expect, it } from 'vitest';
import { adaptDfineSegOutput } from '../src/live/dfineSegAdapter';
import { associateInstanceMasks, type SegmentationSeed } from '../src/live/segmentationEngine';

function makeOutput() {
  const width = 10, height = 12;
  const masks = new Uint8Array(width * height);
  for (let y = 2; y < 10; y++) for (let x = 3; x < 7; x++) masks[y * width + x] = 1;
  return {
    labels: new BigInt64Array([39n, 1n]),
    boxes: new Float32Array([2, 1, 8, 11, 0, 0, 4, 4]),
    scores: new Float32Array([0.94, 0.99]),
    masks: new Uint8Array([...masks, ...new Uint8Array(width * height)]),
    maskWidth: width,
    maskHeight: height,
  };
}

describe('D-FINE instance-mask adapter', () => {
  it('filters to bottle class and crops full-frame masks to normalized detection boxes', () => {
    const result = adaptDfineSegOutput(makeOutput(), 10, 12, 5000);
    expect(result).toHaveLength(1);
    expect(result[0]?.bounds).toEqual({ x: 0.2, y: 1 / 12, width: 0.6, height: 10 / 12 });
    expect(result[0]?.width).toBe(6);
    expect(result[0]?.height).toBe(10);
    expect(result[0]?.sourceTimestampMs).toBe(5000);
  });

  it('feeds the cropped mask into persistent track association', () => {
    const masks = adaptDfineSegOutput(makeOutput(), 10, 12, 5000);
    const seed: SegmentationSeed = {
      trackId: 88,
      bounds: { x: 0.2, y: 1 / 12, width: 0.6, height: 10 / 12 },
      detectionConfidence: 0.9,
      sourceTimestampMs: 5000,
    };
    const result = associateInstanceMasks([seed], masks, { minimumIoU: 0.8, minimumMaskPixels: 4 });
    expect(result).toHaveLength(1);
    expect(result[0]?.trackId).toBe(88);
    expect(result[0]?.contour.bounds.x).toBeGreaterThanOrEqual(seed.bounds.x);
    expect(result[0]?.contour.bounds.x).toBeLessThanOrEqual(seed.bounds.x + seed.bounds.width);
  });

  it('supports explicit class IDs and score thresholds', () => {
    const output = makeOutput();
    expect(adaptDfineSegOutput(output, 10, 12, 5000, { bottleClassIds: [1] })).toHaveLength(1);
    expect(adaptDfineSegOutput(output, 10, 12, 5000, { minimumScore: 0.99 })).toEqual([]);
  });

  it('rejects mismatched mask shapes, invalid boxes, and empty masks', () => {
    const output = makeOutput();
    expect(adaptDfineSegOutput({ ...output, maskWidth: 9 }, 10, 12, 5000)).toEqual([]);
    expect(adaptDfineSegOutput({ ...output, boxes: new Float32Array([NaN, 0, 1, 1, 0, 0, 1, 1]) }, 10, 12, 5000)).toEqual([]);
    expect(adaptDfineSegOutput({ ...output, masks: new Uint8Array(240) }, 10, 12, 5000)).toEqual([]);
  });
});
