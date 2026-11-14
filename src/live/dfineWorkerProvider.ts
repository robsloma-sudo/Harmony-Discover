import type { SegmentationInstance, SegmentationProvider } from './segmentationEngine';
import { adaptDfineSegOnnxOutput, type ContainerClassRule } from './dfineSegAdapter';
import type { DfineOnnxProviderOptions } from './dfineSegOnnxProvider';

export const DFINE_WORKER_URL = '/ort/dfine-worker.mjs';

export type DetectorBackend = 'webgpu' | 'wasm';
export type DetectorBackendPreference = DetectorBackend | 'auto';

type WorkerReply =
  | { type: 'ready'; id: number; backend: DetectorBackend; warmMs?: number; firstMs?: number }
  | { type: 'fallback'; id: number; reason: string }
  | { type: 'error'; id: number; message: string }
  | {
    type: 'result'; id: number; count: number; labels: Int32Array; boxes: Float32Array; scores: Float32Array;
    masks: Float32Array; maskWidth: number; maskHeight: number; inputSize: number; preprocessMs: number; inferenceMs: number;
    backend: DetectorBackend;
  };

export type WorkerLike = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null;
  onerror: ((event: Event) => void) | null;
};

export type WorkerFactory = () => WorkerLike;

const defaultWorkerFactory: WorkerFactory = () => new Worker(DFINE_WORKER_URL, { type: 'module', name: 'discover-bottle-detector' }) as unknown as WorkerLike;

/** Reads an optional override (?detector=wasm|webgpu, or localStorage 'discover.detector'). */
export function detectorBackendPreference(): DetectorBackendPreference {
  const valid = (value: unknown): value is DetectorBackendPreference => value === 'wasm' || value === 'webgpu' || value === 'auto';
  try {
    const fromUrl = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('detector') : null;
    if (valid(fromUrl)) return fromUrl;
  } catch { /* no URL */ }
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('discover.detector') : null;
    if (valid(stored)) return stored;
  } catch { /* storage blocked */ }
  return 'auto';
}

const hasWebGpu = () => typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu;

/** Starts a worker for one backend and waits for its first reply. */
async function startWorker(
  factory: WorkerFactory,
  backend: DetectorBackend,
  modelUrl: string,
  sha256: string,
  timeoutMs: number,
): Promise<{ worker: WorkerLike; reply: WorkerReply }> {
  const worker = factory();
  try {
    const reply = await new Promise<WorkerReply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The bottle detector took too long to start.')), timeoutMs);
      worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
      worker.onerror = () => { clearTimeout(timer); reject(new Error('The bottle detector worker could not start.')); };
      worker.postMessage({ type: 'init', id: 0, modelUrl, sha256, backend });
    });
    return { worker, reply };
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

export type WorkerProviderOptions = DfineOnnxProviderOptions & {
  modelUrl: string;
  sha256: string;
  backend?: DetectorBackendPreference;
  /** Upgrade to the GPU only when its warm run is at most this fraction of the CPU's. */
  gpuSpeedupRatio?: number;
  gpuTrialTimeoutMs?: number;
};

/**
 * Runs D-FINE in a dedicated worker. The camera/UI thread only copies the
 * frame and turns the few returned detections into boxes, so optical flow and
 * drawing never wait for the model.
 *
 * Detection starts on WASM straight away. Where the browser has WebGPU, a
 * second worker tries the GPU in the background; if it gives the CPU's
 * numbers and is clearly faster, new frames move to it and the WASM worker is
 * closed. Otherwise the trial worker is closed and WASM continues.
 */
export class DfineSegWorkerProvider implements SegmentationProvider {
  readonly modelId = 'dfine-seg-coco-instance-onnx';
  private nextId = 1;
  private pending = new Map<number, { worker: WorkerLike; resolve: (reply: WorkerReply) => void; reject: (error: Error) => void }>();
  private retired: WorkerLike[] = [];
  private disposed = false;
  private failure: Error | null = null;
  private worker: WorkerLike;
  backend: DetectorBackend;
  lastInferenceMs = 0;
  /** Settles when the background GPU trial has finished (either way). */
  gpuTrial: Promise<void> = Promise.resolve();
  gpuTrialResult = 'not tried';

  private constructor(
    worker: WorkerLike,
    backend: DetectorBackend,
    private readonly options: WorkerProviderOptions,
    private readonly baselineWarmMs: number,
  ) {
    this.worker = worker;
    this.backend = backend;
    this.attach(worker);
  }

  private attach(worker: WorkerLike): void {
    worker.onmessage = event => this.receive(event.data);
    worker.onerror = () => {
      if (worker === this.worker) this.fail(new Error('The bottle detector worker stopped.'));
      else this.rejectPendingFor(worker, new Error('The bottle detector worker stopped.'));
    };
  }

  static async create(options: WorkerProviderOptions, workerFactory: WorkerFactory = defaultWorkerFactory): Promise<DfineSegWorkerProvider> {
    const preference = options.backend ?? 'auto';
    const { worker, reply } = await startWorker(workerFactory, 'wasm', options.modelUrl, options.sha256, 120_000);
    if (reply.type !== 'ready') {
      worker.terminate();
      throw new Error(reply.type === 'error' ? reply.message : 'The bottle detector worker did not become ready.');
    }
    const provider = new DfineSegWorkerProvider(worker, 'wasm', options, reply.warmMs ?? Number.POSITIVE_INFINITY);
    if (preference !== 'wasm' && hasWebGpu()) provider.gpuTrial = provider.tryGpu(workerFactory, preference === 'webgpu');
    return provider;
  }

  private async tryGpu(workerFactory: WorkerFactory, forced: boolean): Promise<void> {
    let trial: { worker: WorkerLike; reply: WorkerReply } | null = null;
    try {
      trial = await startWorker(workerFactory, 'webgpu', this.options.modelUrl, this.options.sha256, this.options.gpuTrialTimeoutMs ?? 30_000);
    } catch (error) {
      this.gpuTrialResult = 'failed: ' + (error instanceof Error ? error.message : String(error));
      return;
    }
    const { worker, reply } = trial;
    const faster = reply.type === 'ready'
      && (forced || (reply.warmMs ?? Number.POSITIVE_INFINITY) <= this.baselineWarmMs * (this.options.gpuSpeedupRatio ?? 0.7));
    if (this.disposed || reply.type !== 'ready' || !faster) {
      this.gpuTrialResult = reply.type === 'fallback' ? 'rejected: ' + reply.reason
        : reply.type === 'ready' ? `kept wasm (gpu ${Math.round(reply.warmMs ?? 0)} ms vs cpu ${Math.round(this.baselineWarmMs)} ms)`
          : 'failed';
      worker.terminate();
      return;
    }
    // Swap: new frames go to the GPU worker; the CPU worker finishes its
    // in-flight frame, then closes.
    const previous = this.worker;
    this.worker = worker;
    this.backend = 'webgpu';
    this.attach(worker);
    this.gpuTrialResult = `webgpu (${Math.round(reply.warmMs ?? 0)} ms vs cpu ${Math.round(this.baselineWarmMs)} ms)`;
    this.retire(previous);
  }

  private retire(worker: WorkerLike): void {
    if (![...this.pending.values()].some(waiter => waiter.worker === worker)) worker.terminate();
    else this.retired.push(worker);
  }

  private receive(reply: WorkerReply): void {
    const waiter = this.pending.get(reply.id);
    if (!waiter) return;
    this.pending.delete(reply.id);
    waiter.resolve(reply);
    this.retired = this.retired.filter(worker => {
      if ([...this.pending.values()].some(other => other.worker === worker)) return true;
      worker.terminate();
      return false;
    });
  }

  private rejectPendingFor(worker: WorkerLike, error: Error): void {
    for (const [id, waiter] of this.pending) {
      if (waiter.worker !== worker) continue;
      this.pending.delete(id);
      waiter.reject(error);
    }
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  get failed(): boolean {
    return !!this.failure;
  }

  async infer(frame: ImageData, timestamp: number): Promise<SegmentationInstance[]> {
    if (this.disposed || !Number.isFinite(timestamp)) return [];
    if (this.failure) throw this.failure;
    if (!frame || frame.width < 2 || frame.height < 2 || frame.data.length !== frame.width * frame.height * 4) {
      throw new Error('Invalid camera frame for D-FINE preprocessing.');
    }
    const rules: readonly ContainerClassRule[] = this.options.containerClassRules ?? [];
    const classIds = [...(this.options.bottleClassIds ?? [39]), ...rules.map(rule => rule.classId)];
    const minimumScore = Math.min(this.options.minimumScore ?? 0.5, ...rules.map(rule => rule.minimumScore));
    const id = this.nextId++;
    // Copy: the caller keeps using this frame (liquid analysis, appearance).
    const buffer = frame.data.slice().buffer;
    const worker = this.worker;
    const reply = await new Promise<WorkerReply>((resolve, reject) => {
      this.pending.set(id, { worker, resolve, reject });
      worker.postMessage({ type: 'infer', id, width: frame.width, height: frame.height, buffer, classIds, minimumScore }, [buffer]);
    });
    if (this.disposed) return [];
    if (reply.type === 'error') throw new Error(reply.message);
    if (reply.type !== 'result') return [];
    this.lastInferenceMs = reply.inferenceMs;
    return adaptDfineSegOnnxOutput({
      labels: reply.labels,
      boxes: reply.boxes,
      scores: reply.scores,
      masks: reply.masks,
      maskWidth: reply.maskWidth,
      maskHeight: reply.maskHeight,
    }, frame.width, frame.height, reply.inputSize, reply.inputSize, timestamp, {
      bottleClassIds: this.options.bottleClassIds,
      containerClassRules: this.options.containerClassRules,
      minimumScore: this.options.minimumScore,
      maskThreshold: this.options.maskThreshold,
      nmsIoUThreshold: this.options.nmsIoUThreshold,
      modelId: this.modelId,
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.fail(new Error('The bottle detector was closed.'));
    for (const worker of [this.worker, ...this.retired]) {
      try { worker.postMessage({ type: 'dispose', id: 0 }); } catch { /* already gone */ }
      worker.terminate();
    }
    this.retired = [];
  }
}
