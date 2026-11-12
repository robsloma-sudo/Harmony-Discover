import { describe, expect, it, vi } from 'vitest';
import { createDfineSegOnnxProvider, DfineSegOnnxProvider, preprocessDfineImage, type DfineOrtSession, type DfineOrtTensor } from '../src/live/dfineSegOnnxProvider';
function makeFrame(): ImageData {
  return { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(255), colorSpace: 'srgb' } as ImageData;
}

function makeSession(): DfineOrtSession {
  const masks = new Float32Array(1 * 2 * 8 * 8);
  for (let y = 1; y < 7; y++) for (let x = 2; x < 6; x++) masks[y * 8 + x] = 0.95;
  const values: DfineOrtTensor[] = [
    { data: new BigInt64Array([39n, 1n]), dims: [1, 2] },
    { data: new Float32Array([128, 64, 320, 512, 0, 0, 200, 200]), dims: [1, 2, 4] },
    { data: new Float32Array([0.94, 0.99]), dims: [1, 2] },
    { data: masks, dims: [1, 2, 8, 8] },
  ];
  return {
    inputNames: ['images'],
    outputNames: ['labels', 'boxes', 'scores', 'masks'],
    run: vi.fn(async () => ({
      labels: values[0]!, boxes: values[1]!, scores: values[2]!, masks: values[3]!,
    })),
    release: vi.fn(),
  };
}

describe('D-FINE ONNX provider', () => {
  it('resizes RGBA camera frames into normalized NCHW RGB input', () => {
    const frame = makeFrame();
    const input = preprocessDfineImage(frame, 4);
    expect(input).toHaveLength(3 * 4 * 4);
    expect(input[0]).toBe(1);
    expect(input[16]).toBe(1);
    expect(input[32]).toBe(1);
  });

  it('runs injected ONNX session and returns cropped bottle masks', async () => {
    const session = makeSession();
    const tensorFactory = vi.fn((_type: 'float32', data: Float32Array, dims: number[]) => ({ data, dims }));
    const provider = new DfineSegOnnxProvider(session, tensorFactory, { inputSize: 640 });
    const result = await provider.infer(makeFrame(), 1000);
    expect(tensorFactory).toHaveBeenCalledWith('float32', expect.any(Float32Array), [1, 3, 640, 640]);
    expect(session.run).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]?.modelId).toBe('dfine-seg-coco-instance-onnx');
    expect(result[0]?.sourceTimestampMs).toBe(1000);
    await provider.dispose();
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it('creates the provider with WASM as the required baseline execution provider', async () => {
    const session = makeSession();
    const create = vi.fn(async () => session);
    class Tensor {
      constructor(public type: string, public data: Float32Array, public dims: number[]) {}
    }
    const runtime = { env: { wasm: {} as { wasmPaths?: string; numThreads?: number } }, Tensor, InferenceSession: { create } };
    const provider = await createDfineSegOnnxProvider(runtime, new Uint8Array([1, 2, 3]), { inputSize: 640 });
    expect(create).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), { executionProviders: ['wasm'] });
    expect(provider).toBeInstanceOf(DfineSegOnnxProvider);
    expect(runtime.env.wasm).toEqual({ wasmPaths: '/ort/', numThreads: 1 });
    await provider.dispose();
  });

  it('rejects invalid timestamps and malformed graph output shapes', async () => {
    const session = makeSession();
    const provider = new DfineSegOnnxProvider(session, (_type, data, dims) => ({ data, dims }), { inputSize: 640 });
    expect(await provider.infer(makeFrame(), Number.NaN)).toEqual([]);
    const badSession = makeSession();
    badSession.run = vi.fn(async () => ({ labels: { data: [39], dims: [1] }, boxes: { data: [], dims: [1] }, scores: { data: [], dims: [1] }, masks: { data: [], dims: [1] } }));
    const badProvider = new DfineSegOnnxProvider(badSession, (_type, data, dims) => ({ data, dims }), { inputSize: 640 });
    await expect(badProvider.infer(makeFrame(), 1000)).rejects.toThrow('Unexpected D-FINE ONNX output tensor ranks');
    await provider.dispose();
    await badProvider.dispose();
  });
});
