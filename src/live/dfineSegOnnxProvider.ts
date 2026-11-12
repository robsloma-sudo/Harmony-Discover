import type { SegmentationInstance, SegmentationProvider } from './segmentationEngine';
import { adaptDfineSegOnnxOutput } from './dfineSegAdapter';

export type DfineOrtTensor = {
  data: ArrayLike<number | bigint>;
  dims: number[];
};

export type DfineOrtSession = {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, DfineOrtTensor>>;
  release?(): Promise<void> | void;
};

export type DfineTensorFactory = (
  type: 'float32',
  data: Float32Array,
  dims: number[],
) => unknown;

export type DfineOnnxProviderOptions = {
  inputSize?: number;
  bottleClassIds?: number[];
  minimumScore?: number;
  maskThreshold?: number;
  nmsIoUThreshold?: number;
};

/** Bilinear RGB resize + NCHW float32 normalization matching D-FINE's RGB path. */
export function preprocessDfineImage(frame: ImageData, size: number): Float32Array {
  if (!frame || frame.width < 2 || frame.height < 2 || frame.data.length !== frame.width * frame.height * 4) {
    throw new Error('Invalid camera frame for D-FINE preprocessing.');
  }
  const output = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let y = 0; y < size; y++) {
    const sourceY = Math.max(0, Math.min(frame.height - 1, (y + 0.5) * frame.height / size - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(frame.height - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < size; x++) {
      const sourceX = Math.max(0, Math.min(frame.width - 1, (x + 0.5) * frame.width / size - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(frame.width - 1, x0 + 1);
      const fx = sourceX - x0;
      const p00 = (y0 * frame.width + x0) * 4;
      const p01 = (y0 * frame.width + x1) * 4;
      const p10 = (y1 * frame.width + x0) * 4;
      const p11 = (y1 * frame.width + x1) * 4;
      const target = y * size + x;
      for (let channel = 0; channel < 3; channel++) {
        const top = frame.data[p00 + channel]! * (1 - fx) + frame.data[p01 + channel]! * fx;
        const bottom = frame.data[p10 + channel]! * (1 - fx) + frame.data[p11 + channel]! * fx;
        output[channel * plane + target] = (top * (1 - fy) + bottom * fy) / 255;
      }
    }
  }
  return output;
}

/**
 * D-FINE-seg ONNX provider with injected ONNX Runtime Web bindings.
 * Injection keeps the core app independent of a hard package dependency until
 * the exact runtime bundle/version and WASM asset strategy are locked down.
 */
export class DfineSegOnnxProvider implements SegmentationProvider {
  readonly modelId = 'dfine-seg-coco-instance-onnx';
  private disposed = false;
  private readonly inputSize: number;

  constructor(
    private readonly session: DfineOrtSession,
    private readonly tensorFactory: DfineTensorFactory,
    private readonly options: DfineOnnxProviderOptions = {},
  ) {
    this.inputSize = options.inputSize ?? 640;
    if (!Number.isInteger(this.inputSize) || this.inputSize < 64) {
      throw new Error('D-FINE input size must be an integer of at least 64.');
    }
    if (!session.inputNames[0] || session.outputNames.length < 4) {
      throw new Error('D-FINE ONNX graph must expose one input and labels, boxes, scores, masks outputs.');
    }
  }

  async infer(frame: ImageData, timestamp: number): Promise<SegmentationInstance[]> {
    if (this.disposed || !Number.isFinite(timestamp)) return [];

    const input = preprocessDfineImage(frame, this.inputSize);
    const tensor = this.tensorFactory('float32', input, [1, 3, this.inputSize, this.inputSize]);
    const raw = await this.session.run({ [this.session.inputNames[0]!]: tensor });
    if (this.disposed) return [];

    const outputs = this.session.outputNames.map(name => raw[name]);
    if (outputs.some(value => !value)) throw new Error('D-FINE ONNX output is missing.');
    const [labels, boxes, scores, masks] = outputs as DfineOrtTensor[];
    if (labels!.dims.length !== 2 || boxes!.dims.length !== 3 || scores!.dims.length !== 2 || masks!.dims.length !== 4) {
      throw new Error('Unexpected D-FINE ONNX output tensor ranks.');
    }
    const batch = labels!.dims[0];
    const count = labels!.dims[1];
    const maskHeight = masks!.dims[2];
    const maskWidth = masks!.dims[3];
    if (batch !== 1 || boxes!.dims[0] !== batch || boxes!.dims[1] !== count || boxes!.dims[2] !== 4 ||
        scores!.dims[0] !== batch || scores!.dims[1] !== count || masks!.dims[0] !== batch || masks!.dims[1] !== count ||
        labels!.data.length !== count || boxes!.data.length !== count * 4 ||
        scores!.data.length !== count || masks!.data.length !== count * maskHeight * maskWidth) {
      throw new Error('D-FINE ONNX output tensor dimensions do not match the expected batch-one contract.');
    }

    const labelData = Array.from(labels!.data);
    const boxData = Array.from(boxes!.data, value => Number(value));
    const scoreData = Array.from(scores!.data, value => Number(value));
    const maskData = masks!.data;
    if (!(maskData instanceof Float32Array) && !(maskData instanceof Uint8Array)) {
      throw new Error('D-FINE masks must be Float32Array or Uint8Array output.');
    }
    return adaptDfineSegOnnxOutput({
      labels: labelData,
      boxes: boxData,
      scores: scoreData,
      masks: maskData,
      maskWidth,
      maskHeight,
    }, frame.width, frame.height, this.inputSize, this.inputSize, timestamp, {
      bottleClassIds: this.options.bottleClassIds,
      minimumScore: this.options.minimumScore,
      maskThreshold: this.options.maskThreshold,
      nmsIoUThreshold: this.options.nmsIoUThreshold,
      modelId: this.modelId,
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.session.release?.();
  }
}


export type DfineOrtRuntime = {
  env?: { wasm?: { wasmPaths?: string; numThreads?: number } };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
  InferenceSession: {
    create(
      model: string | ArrayBuffer | Uint8Array,
      options: { executionProviders: string[] },
    ): Promise<DfineOrtSession>;
  };
};

/**
 * Creates a WASM-first provider from an injected ONNX Runtime Web module and
 * a model URL or byte buffer. The app is responsible for loading the runtime
 * module and fetching/verifying model bytes before calling this function.
 */
export async function createDfineSegOnnxProvider(
  runtime: DfineOrtRuntime,
  model: string | ArrayBuffer | Uint8Array,
  options: DfineOnnxProviderOptions = {},
): Promise<DfineSegOnnxProvider> {
  if (runtime.env?.wasm) {
    runtime.env.wasm.wasmPaths = '/ort/';
    runtime.env.wasm.numThreads = 1;
  }
  const session = await runtime.InferenceSession.create(model, {
    executionProviders: ['wasm'],
  });
  return new DfineSegOnnxProvider(
    session,
    (type, data, dims) => new runtime.Tensor(type, data, dims),
    options,
  );
}
