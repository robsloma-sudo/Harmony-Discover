import { describe, expect, it, vi } from 'vitest';
import {
  associateInstanceMasks,
  normalizedIoU,
  SegmentationRunner,
  type SegmentationInstance,
  type SegmentationProvider,
  type SegmentationSeed,
} from '../src/live/segmentationEngine';

const seed = (trackId = 1): SegmentationSeed => ({
  trackId,
  bounds: { x: 0.2, y: 0.1, width: 0.3, height: 0.7 },
  detectionConfidence: 0.92,
  sourceTimestampMs: 1000,
});

function instance(overrides: Partial<SegmentationInstance> = {}): SegmentationInstance {
  const width = overrides.width ?? 20;
  const height = overrides.height ?? 30;
  const data = overrides.data ?? new Uint8Array(width * height).map((_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return x >= 4 && x < 16 && y >= 3 && y < 27 ? 1 : 0;
  });
  return {
    width,
    height,
    data,
    bounds: { x: 0.2, y: 0.1, width: 0.3, height: 0.7 },
    detectionConfidence: 0.95,
    sourceTimestampMs: 1000,
    modelId: 'fixture-seg-n',
    ...overrides,
  };
}

const frame = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) } as ImageData;

describe('segmentation engine association', () => {
  it('computes normalized intersection-over-union', () => {
    expect(normalizedIoU(
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    )).toBeCloseTo(1 / 7, 5);
  });

  it('associates a real mask contour to its persistent track ID', () => {
    const result = associateInstanceMasks([seed()], [instance()]);
    expect(result).toHaveLength(1);
    expect(result[0]?.trackId).toBe(1);
    expect(result[0]?.modelId).toBe('fixture-seg-n');
    expect(result[0]?.contour.points.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects stale masks and low-confidence detections', () => {
    expect(associateInstanceMasks([seed()], [instance({ sourceTimestampMs: 1400 })])).toEqual([]);
    expect(associateInstanceMasks([{ ...seed(), detectionConfidence: 0.2 }], [instance()])).toEqual([]);
  });

  it('rejects low-confidence, malformed, and empty masks', () => {
    expect(associateInstanceMasks([seed()], [instance({ confidence: 0.1 })])).toEqual([]);
    expect(associateInstanceMasks([seed()], [instance({ data: new Uint8Array(2) })])).toEqual([]);
    expect(associateInstanceMasks([seed()], [instance({ data: new Uint8Array(600) })])).toEqual([]);
  });

  it('does not assign one mask to two similarly overlapping tracks', () => {
    const seeds = [
      { ...seed(1), bounds: { x: 0.19, y: 0.1, width: 0.32, height: 0.7 } },
      { ...seed(2), bounds: { x: 0.21, y: 0.1, width: 0.32, height: 0.7 } },
    ];
    expect(associateInstanceMasks(seeds, [instance()])).toEqual([]);
  });

  it('does not reuse a single mask for multiple tracks', () => {
    const result = associateInstanceMasks(
      [seed(1), { ...seed(2), bounds: { x: 0.55, y: 0.1, width: 0.25, height: 0.7 } }],
      [instance()],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.trackId).toBe(1);
  });
});

describe('segmentation runner lifecycle', () => {
  it('enforces single-flight inference and bounded cadence independently of detections', async () => {
    let now = 2000;
    let resolveInference: ((value: SegmentationInstance[]) => void) | undefined;
    const provider: SegmentationProvider = {
      modelId: 'test',
      infer: vi.fn(() => new Promise<SegmentationInstance[]>(resolve => { resolveInference = resolve; })),
    };
    const runner = new SegmentationRunner(provider, { now: () => now, minimumIntervalMs: 1000 });
    const pending = runner.runInference(frame, 2000);
    expect(await runner.runInference(frame, 2000)).toEqual([]);
    resolveInference?.([instance({ sourceTimestampMs: 2000 })]);
    const masks = await pending;
    expect(masks).toHaveLength(1);
    expect(associateInstanceMasks([{ ...seed(), sourceTimestampMs: 2000 }], masks)).toHaveLength(1);
    expect(await runner.runInference(frame, 2500)).toEqual([]);
    now = 3001;
    const next = runner.runInference(frame, 3001);
    resolveInference?.([instance({ sourceTimestampMs: 3001 })]);
    expect(await next).toHaveLength(1);
    expect(provider.infer).toHaveBeenCalledTimes(2);
    await runner.dispose();
  });

  it('supports the convenience runFrame association path', async () => {
    const provider: SegmentationProvider = {
      modelId: 'test',
      infer: async (_frame, timestamp) => [instance({ sourceTimestampMs: timestamp })],
    };
    const runner = new SegmentationRunner(provider, { now: () => 1000 });
    const result = await runner.runFrame(frame, 1000, [seed()]);
    expect(result).toHaveLength(1);
    expect(result[0]?.trackId).toBe(1);
    await runner.dispose();
  });

  it('discards inference results after reset', async () => {
    let now = 2000;
    let resolveInference: ((value: SegmentationInstance[]) => void) | undefined;
    const provider: SegmentationProvider = {
      modelId: 'test',
      infer: () => new Promise<SegmentationInstance[]>(resolve => { resolveInference = resolve; }),
    };
    const runner = new SegmentationRunner(provider, { now: () => now });
    const pending = runner.runInference(frame, 2000);
    runner.reset();
    resolveInference?.([instance({ sourceTimestampMs: 2000 })]);
    expect(await pending).toEqual([]);
    await runner.dispose();
  });

  it('disposes the provider once and rejects future work', async () => {
    const dispose = vi.fn();
    const provider: SegmentationProvider = { modelId: 'test', infer: async () => [], dispose };
    const runner = new SegmentationRunner(provider);
    await runner.dispose();
    await runner.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(await runner.runInference(frame, Date.now())).toEqual([]);
  });
});
