import { describe, expect, it } from 'vitest';
import * as workerModule from '../scripts/dfine-worker.mjs';
import { preprocessDfineImage } from '../src/live/dfineSegOnnxProvider';
import { DfineSegWorkerProvider, type WorkerFactory } from '../src/live/dfineWorkerProvider';
import { adaptDfineSegOnnxOutput } from '../src/live/dfineSegAdapter';

const worker = workerModule as {
  preprocessRgba(rgba: Uint8ClampedArray, width: number, height: number, size?: number): Float32Array;
  selectDetections(labels: ArrayLike<number | bigint>, scores: ArrayLike<number>, classIds: number[], minimumScore: number): number[];
  packDetections(indices: number[], labels: ArrayLike<number | bigint>, boxes: ArrayLike<number>, scores: ArrayLike<number>, masks: Float32Array, maskSize: number): { count: number; labels: Int32Array; boxes: Float32Array; scores: Float32Array; masks: Float32Array };
  matchesValidationReference(output: { labels: ArrayLike<number | bigint>; scores: ArrayLike<number>; boxes: ArrayLike<number>; masks: ArrayLike<number>; maskSize: number }): boolean;
  validationInput(size?: number): Float32Array;
  VALIDATION_REFERENCE: { labels: number[]; scores: number[]; boxes: number[]; mask0Center: number; mask0Mean: number };
};

function frame(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37 + (i >> 6)) % 256;
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

describe('bottle detector worker helpers', () => {
  it('preprocesses camera pixels exactly like the main-thread path', () => {
    const image = frame(37, 53);
    const fromWorker = worker.preprocessRgba(image.data, image.width, image.height, 64);
    const fromMain = preprocessDfineImage(image, 64);
    expect(fromWorker.length).toBe(fromMain.length);
    let maxDifference = 0;
    for (let i = 0; i < fromMain.length; i++) maxDifference = Math.max(maxDifference, Math.abs(fromWorker[i]! - fromMain[i]!));
    expect(maxDifference).toBeLessThan(1e-6);
  });

  it('returns only bottle-class queries and gives the same boxes as the full output', () => {
    const count = 6, maskSide = 8, maskSize = maskSide * maskSide;
    const labels = [39, 73, 0, 39, 39, 73];
    const scores = [0.91, 0.66, 0.99, 0.3, 0.72, 0.62];
    const boxes = [
      100, 100, 160, 400, 300, 120, 360, 380, 10, 10, 50, 50,
      400, 100, 460, 400, 500, 90, 560, 420, 200, 300, 230, 330,
    ];
    const masks = new Float32Array(count * maskSize).fill(0.9);
    const indices = worker.selectDetections(labels, scores, [39, 73], 0.5);
    expect(indices).toEqual([0, 1, 4, 5]);
    const packed = worker.packDetections(indices, labels, boxes, scores, masks, maskSize);
    const options = { bottleClassIds: [39], containerClassRules: [{ classId: 73, minAspect: 1.6, minimumScore: 0.58 }], minimumScore: 0.5, nmsIoUThreshold: 0.45 };
    const full = adaptDfineSegOnnxOutput({ labels, boxes, scores, masks, maskWidth: maskSide, maskHeight: maskSide }, 480, 640, 640, 640, 1, options);
    const reduced = adaptDfineSegOnnxOutput({ labels: packed.labels, boxes: packed.boxes, scores: packed.scores, masks: packed.masks, maskWidth: maskSide, maskHeight: maskSide }, 480, 640, 640, 640, 1, options);
    expect(reduced.map(item => item.bounds)).toEqual(full.map(item => item.bounds));
    expect(reduced.length).toBeGreaterThan(0);
  });

  it('accepts accelerated output that matches the CPU reference and rejects garbage', () => {
    const reference = worker.VALIDATION_REFERENCE;
    const maskSide = 160, maskSize = maskSide * maskSide;
    const masks = new Float32Array(maskSize).fill(reference.mask0Mean);
    masks[(maskSide >> 1) * maskSide + (maskSide >> 1)] = reference.mask0Center;
    const good = { labels: [6, 6, 6, 6, 6], scores: reference.scores.map(v => v + 0.001), boxes: reference.boxes.map(v => v + 0.5), masks, maskSize };
    expect(worker.matchesValidationReference(good)).toBe(true);
    expect(worker.matchesValidationReference({ ...good, scores: [0.5, 0.4, 0.3, 0.2, 0.1] })).toBe(false);
    expect(worker.matchesValidationReference({ ...good, masks: new Float32Array(maskSize) })).toBe(false);
    expect(worker.matchesValidationReference({ ...good, labels: [0, 0, 0] })).toBe(false);
  });

  it('builds the deterministic validation input', () => {
    const input = worker.validationInput(8);
    expect(input).toHaveLength(3 * 8 * 8);
    expect(input[1]).toBeCloseTo(((2654435761) % 1000) / 1000, 6);
  });
});

type Posted = { type: string; id: number; backend?: string };

function fakeWorkers(script: (message: Posted, reply: (data: unknown) => void, workerIndex: number) => void) {
  const created: Array<{ terminated: boolean; messages: Posted[] }> = [];
  const factory: WorkerFactory = () => {
    const record = { terminated: false, messages: [] as Posted[] };
    const index = created.length;
    created.push(record);
    const fake = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      postMessage(message: Posted) {
        record.messages.push(message);
        queueMicrotask(() => script(message, data => fake.onmessage?.({ data } as MessageEvent), index));
      },
      terminate() { record.terminated = true; },
    };
    return fake;
  };
  return { factory, created };
}

describe('bottle detector worker provider', () => {
  const options = { modelUrl: '/models/m.onnx', sha256: 'x', bottleClassIds: [39], minimumScore: 0.5 };
  const withGpu = async (run: () => Promise<void>) => {
    Object.defineProperty(globalThis.navigator, 'gpu', { value: {}, configurable: true });
    try { await run(); } finally { delete (globalThis.navigator as { gpu?: unknown }).gpu; }
  };
  const ready = (backend: string, warmMs: number) => ({ type: 'ready', id: 0, backend, warmMs });

  it('starts on WASM and moves to the GPU when it is verified and faster', () => withGpu(async () => {
    const { factory, created } = fakeWorkers((message, reply) => {
      if (message.type === 'init') reply(message.backend === 'webgpu' ? ready('webgpu', 90) : ready('wasm', 700));
    });
    const provider = await DfineSegWorkerProvider.create(options, factory);
    expect(provider.backend).toBe('wasm');
    await provider.gpuTrial;
    expect(provider.backend).toBe('webgpu');
    expect(created).toHaveLength(2);
    expect(created[0]!.terminated).toBe(true);
    expect(created[1]!.terminated).toBe(false);
    await provider.dispose();
  }));

  it('keeps WASM when the GPU fails its accuracy check or is not faster', () => withGpu(async () => {
    for (const gpuReply of [{ type: 'fallback', id: 0, reason: 'mismatch' }, ready('webgpu', 650)]) {
      const { factory, created } = fakeWorkers((message, reply) => {
        if (message.type === 'init') reply(message.backend === 'webgpu' ? gpuReply : ready('wasm', 700));
      });
      const provider = await DfineSegWorkerProvider.create(options, factory);
      await provider.gpuTrial;
      expect(provider.backend).toBe('wasm');
      expect(created[0]!.terminated).toBe(false);
      expect(created[1]!.terminated).toBe(true);
      await provider.dispose();
    }
  }));

  it('never tries the GPU when WASM is requested', () => withGpu(async () => {
    const { factory, created } = fakeWorkers((message, reply) => {
      if (message.type === 'init') reply(ready(String(message.backend), 500));
    });
    const provider = await DfineSegWorkerProvider.create({ ...options, backend: 'wasm' }, factory);
    await provider.gpuTrial;
    expect(created).toHaveLength(1);
    await provider.dispose();
  }));

  it('turns worker detections into bottle boxes', async () => {
    const { factory } = fakeWorkers((message, reply) => {
      if (message.type === 'init') reply(ready('wasm', 500));
      if (message.type === 'infer') reply({
        type: 'result', id: message.id, count: 1,
        labels: new Int32Array([39]), boxes: new Float32Array([64, 64, 192, 576]), scores: new Float32Array([0.9]),
        masks: new Float32Array(16).fill(1), maskWidth: 4, maskHeight: 4, inputSize: 640, preprocessMs: 1, inferenceMs: 40, backend: 'wasm',
      });
    });
    const provider = await DfineSegWorkerProvider.create(options, factory);
    const instances = await provider.infer(frame(64, 64), 123);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.bounds.x).toBeCloseTo(0.1, 1);
    expect(instances[0]!.bounds.height).toBeCloseTo(0.8, 1);
    expect(instances[0]!.sourceTimestampMs).toBe(123);
    expect(provider.lastInferenceMs).toBe(40);
    await provider.dispose();
  });

  it('rejects in-flight work when the worker dies', async () => {
    let fakeError: (() => void) | null = null;
    const factory: WorkerFactory = () => {
      const fake = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        postMessage(message: Posted) {
          if (message.type === 'init') queueMicrotask(() => fake.onmessage?.({ data: ready('wasm', 500) } as MessageEvent));
          if (message.type === 'infer') fakeError = () => fake.onerror?.(new Event('error'));
        },
        terminate() {},
      };
      return fake;
    };
    const provider = await DfineSegWorkerProvider.create(options, factory);
    const pending = provider.infer(frame(8, 8), 1);
    fakeError!();
    await expect(pending).rejects.toThrow(/stopped/);
    expect(provider.failed).toBe(true);
  });
});

describe('boxes-only detector output', () => {
  it('gives the same boxes as the mask output without the mask head', () => {
    const labels = [39, 73, 39];
    const scores = [0.91, 0.66, 0.72];
    const boxes = [100, 100, 160, 400, 300, 120, 360, 380, 500, 90, 560, 420];
    const masks = new Float32Array(3 * 64).fill(0.9);
    const options = { bottleClassIds: [39], containerClassRules: [{ classId: 73, minAspect: 1.6, minimumScore: 0.58 }], minimumScore: 0.5, nmsIoUThreshold: 0.45 };
    const withMasks = adaptDfineSegOnnxOutput({ labels, boxes, scores, masks, maskWidth: 8, maskHeight: 8 }, 480, 640, 640, 640, 1, options);
    const boxesOnly = adaptDfineSegOnnxOutput({ labels, boxes, scores, masks: new Float32Array(0), maskWidth: 0, maskHeight: 0 }, 480, 640, 640, 640, 1, options);
    expect(boxesOnly.map(item => item.bounds)).toEqual(withMasks.map(item => item.bounds));
    expect(boxesOnly.map(item => item.detectionConfidence)).toEqual(withMasks.map(item => item.detectionConfidence));
    expect(boxesOnly[0]!.data).toHaveLength(boxesOnly[0]!.width * boxesOnly[0]!.height);
  });
});
