import { describe, expect, it } from 'vitest';
import { adaptDfineSegOnnxOutput, adaptDfineSegOutput } from '../src/live/dfineSegAdapter';
import { associateInstanceMasks, type SegmentationSeed } from '../src/live/segmentationEngine';

function makeOutput() {
  const width = 10, height = 12;
  const masks = new Uint8Array(width * height);
  for (let y = 2; y < 10; y++) for (let x = 3; x < 7; x++) masks[y * width + x] = 1;
  return {
    labels: [39, 1],
    boxes: new Float32Array([2, 1, 8, 11, 0, 0, 4, 4]),
    scores: new Float32Array([0.94, 0.99]),
    masks: new Uint8Array([...masks, ...new Uint8Array(width * height)]),
    maskWidth: width,
    maskHeight: height,
  };
}

describe('D-FINE raw ONNX instance-mask adapter', () => {
  it('decodes bottle proposals and crops low-resolution masks into camera-normalized bounds', () => {
    const width = 8, height = 8;
    const firstMask = new Float32Array(width * height);
    for (let y = 1; y < 7; y++) for (let x = 2; x < 6; x++) firstMask[y * width + x] = 0.9;
    const output = {
      labels: [39, 1],
      boxes: new Float32Array([128, 64, 320, 512, 0, 0, 200, 200]),
      scores: new Float32Array([0.91, 0.99]),
      masks: new Float32Array([...firstMask, ...new Float32Array(width * height)]),
      maskWidth: width,
      maskHeight: height,
    };
    const result = adaptDfineSegOnnxOutput(output, 1280, 720, 640, 640, 8000);
    expect(result).toHaveLength(1);
    expect(result[0]?.bounds).toEqual({ x: 0.2, y: 0.1, width: 0.3, height: 0.7 });
    expect(result[0]?.width).toBe(3);
    expect(result[0]?.height).toBe(6);
    expect(result[0]?.sourceTimestampMs).toBe(8000);
  });

  it('suppresses duplicate same-class proposals and rejects empty masks', () => {
    const width = 8, height = 8;
    const mask = new Uint8Array(width * height).fill(1);
    const output = {
      labels: [39, 39],
      boxes: new Float32Array([128, 64, 320, 512, 130, 66, 318, 510]),
      scores: new Float32Array([0.91, 0.89]),
      masks: new Uint8Array([...mask, ...mask]),
      maskWidth: width,
      maskHeight: height,
    };
    expect(adaptDfineSegOnnxOutput(output, 1280, 720, 640, 640, 8000)).toHaveLength(1);
    expect(adaptDfineSegOnnxOutput({ ...output, masks: new Uint8Array(128) }, 1280, 720, 640, 640, 8000)).toEqual([]);
  });

  it('rejects malformed tensor dimensions and filters non-bottle classes', () => {
    const output = {
      labels: [1],
      boxes: new Float32Array([128, 64, 320, 512]),
      scores: new Float32Array([0.99]),
      masks: new Uint8Array(64).fill(1),
      maskWidth: 8,
      maskHeight: 8,
    };
    expect(adaptDfineSegOnnxOutput(output, 1280, 720, 640, 640, 8000)).toEqual([]);
    expect(adaptDfineSegOnnxOutput({ ...output, boxes: new Float32Array(2) }, 1280, 720, 640, 640, 8000, { bottleClassIds: [1] })).toEqual([]);
  });
});

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
