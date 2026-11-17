/**
 * On-phone label text reader (Rob, 17 Nov 2026): reads the biggest words on a label crop in a worker,
 * in about a third of a second, so the box can say "Probably Jameson" before the cloud read returns.
 * It runs beside the cloud read, never instead of it, and is skipped on phones that already ran out of
 * memory with the scanner.
 */
import type { PixelCrop } from './labelCrop';
import type { OcrWord } from './letterGuess';

export const OCR_WORKER_URL = '/ort/ocr-worker.mjs';
export const OCR_MODELS = Object.freeze({
  detUrl: '/models/ocr/ppocr_v3_det.onnx',
  detSha256: 'ee40e80071ba3a320d4efda75f3e22047a7d049e9bf7bcaaf9daea23fc21b935',
  recUrl: '/models/ocr/ppocr_v5_en_rec.onnx',
  recSha256: '4e16deb22c4da6468bdca539b2cd3c8687825538b67109177c47d359ab994cd7',
  dictUrl: '/models/ocr/ppocr_v5_en_dict.txt',
  dictSha256: 'e025a66d31f327ba0c232e03f407ae8d105e1e709e7ccb3f408aa778c24e70d6',
});

export type Cylinder = { centerX: number; radius: number };
export type TextRead = { words: OcrWord[]; detMs: number; totalMs: number; unrolledReads: number };

/**
 * Where the round bottle sits in a label crop (crop output pixels): its centre and half-width.
 * Used to unroll the squeezed letters at the bottle's edges.
 */
export function cylinderForCrop(bottle: { x: number; width: number }, crop: PixelCrop, frameWidth: number): Cylinder | null {
  if (!(bottle.width > 0) || !(crop.sw > 0) || !(frameWidth > 0)) return null;
  const scale = crop.outputWidth / crop.sw;
  const radius = (bottle.width * frameWidth * scale) / 2;
  const centerX = ((bottle.x + bottle.width / 2) * frameWidth - crop.sx) * scale;
  return radius > 4 ? { centerX, radius } : null;
}

/** True on phones and tablets (where the text reader shares memory and processor with the bottle detector). */
export function isPhoneUserAgent(userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent ?? '') : ''): boolean {
  return /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent);
}

/**
 * Computers: on by default; Settings > Quick Guess, ?ocr=on or ?ocr=off change it (remembered).
 * Phones (17 Nov 2026): Quick Guess is not offered. Running the reader beside the bottle detector ran iPhones
 * out of memory (the page restarted). A phone loads it only for one page visit with ?ocr=on (testing);
 * a remembered "on" from the Settings switch is ignored there.
 */
export function textReaderEnabled(userAgent = typeof navigator !== 'undefined' ? String(navigator.userAgent ?? '') : ''): boolean {
  const phone = isPhoneUserAgent(userAgent);
  try {
    const fromUrl = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('ocr') : null;
    if (fromUrl === 'off') { try { localStorage.setItem('discover.ocr', 'off'); } catch { /* storage blocked */ } return false; }
    if (fromUrl === 'on') {
      if (!phone) { try { localStorage.setItem('discover.ocr', 'on'); } catch { /* storage blocked */ } }
      return true;
    }
  } catch { /* no URL */ }
  if (phone) return false;
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('discover.ocr') : null;
    if (stored === 'off') return false;
    if (stored === 'on') return true;
  } catch { /* storage blocked */ }
  return true;
}

/** Phone reads are spaced out so the bottle detector keeps the processor (ms between reads). */
export const PHONE_READ_GAP_MS = 3_000;
/** The reader only needs the biggest words: crops are shrunk to this long edge before reading. */
export const OCR_MAX_EDGE = 640;

type Reply = { type: 'ready' | 'result' | 'error' | 'fallback'; id: number; message?: string; reason?: string; backend?: TextBackend; warmMs?: number } & Partial<TextRead>;
export type TextBackend = 'webgpu' | 'wasm';
export type TextWorkerLike = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<Reply>) => void) | null;
  onerror: ((event: Event) => void) | null;
};

/** How much to read. Phones read the 2 biggest words on a 320 px picture (about half the work). */
export function readSettings(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  return /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent) ? { detLongSide: 320, maxWords: 2 } : { detLongSide: 480, maxWords: 4 };
}

/** The GPU self-check (drawing and reading one word) must finish within this, or the processor is used. */
export const MAX_GPU_WARM_MS = 150;

const hasWebGpu = () => typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu;

/**
 * One worker, one read at a time; extra requests while busy are dropped (the next label batch retries).
 * The graphics chip (WebGPU) is tried first, so reading does not compete with the bottle detector for the
 * processor; if the chip is missing or fails its self-check, the processor (WASM) is used.
 */
export class LabelTextReader {
  private worker: TextWorkerLike | null = null;
  private starting: Promise<void> | null = null;
  private failed = false;
  private busy = false;
  private nextId = 1;
  private pending = new Map<number, { resolve: (read: TextRead) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  backend: TextBackend | null = null;
  gpuNote = '';

  constructor(
    private readonly factory: () => TextWorkerLike = () => new Worker(OCR_WORKER_URL, { type: 'module', name: 'discover-label-text' }) as unknown as TextWorkerLike,
    private readonly startTimeoutMs = 25_000,
    private readonly readTimeoutMs = 4_000,
    private readonly settings = readSettings(),
    private readonly tryGpu = hasWebGpu(),
  ) {}

  get available() { return !this.failed; }
  get isBusy() { return this.busy || !!this.starting; }

  private boot(backend: TextBackend): Promise<{ worker: TextWorkerLike; reply: Reply }> {
    return new Promise((resolve, reject) => {
      const worker = this.factory();
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('The label text reader took too long to start.')); }, this.startTimeoutMs);
      worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('The label text reader could not start.')); };
      worker.onmessage = event => {
        if (event.data.id !== 0) return;
        clearTimeout(timer);
        if (event.data.type === 'error') { worker.terminate(); reject(new Error(event.data.message || 'The label text reader could not start.')); }
        else resolve({ worker, reply: event.data });
      };
      worker.postMessage({ type: 'init', id: 0, backend, ...OCR_MODELS });
    });
  }

  private start(): Promise<void> {
    if (this.worker) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = (async () => {
      if (this.tryGpu) {
        try {
          const { worker, reply } = await this.boot('webgpu');
          // A slow graphics chip (its self-check read took long) is no help: use the processor instead.
          if (reply.type === 'ready' && !((reply.warmMs ?? 0) > MAX_GPU_WARM_MS)) { this.worker = worker; this.backend = 'webgpu'; this.attach(worker); return; }
          this.gpuNote = reply.type === 'ready' ? 'gpu_slow_' + Math.round(reply.warmMs ?? 0) + 'ms' : reply.reason || 'gpu_fallback';
          worker.terminate();
        } catch (error) {
          this.gpuNote = error instanceof Error ? error.message : String(error);
        }
      }
      const { worker } = await this.boot('wasm');
      this.worker = worker;
      this.backend = 'wasm';
      this.attach(worker);
    })().catch(error => {
      this.failed = true;
      throw error;
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  private attach(worker: TextWorkerLike) {
    worker.onmessage = event => {
      const reply = event.data;
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      clearTimeout(waiting.timer);
      if (reply.type === 'result') waiting.resolve({ words: reply.words ?? [], detMs: reply.detMs ?? 0, totalMs: reply.totalMs ?? 0, unrolledReads: reply.unrolledReads ?? 0 });
      else waiting.reject(new Error(reply.message || 'label_text_read_failed'));
    };
    worker.onerror = () => {
      this.failed = true;
      for (const waiting of this.pending.values()) { clearTimeout(waiting.timer); waiting.reject(new Error('The label text reader stopped.')); }
      this.pending.clear();
    };
  }

  /** Reads the biggest words. Returns null when busy, unavailable or still starting up. */
  async read(image: ImageData, cylinder: Cylinder | null): Promise<TextRead | null> {
    if (this.failed || this.busy) return null;
    if (!this.worker) {
      if (!this.starting) void this.start().catch(() => { /* marked failed; the cloud read carries on */ });
      return null;
    }
    const worker = this.worker;
    this.busy = true;
    try {
      const id = this.nextId++;
      const buffer = image.data.buffer.slice(0);
      return await new Promise<TextRead>((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('label_text_read_timeout')); }, this.readTimeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        worker.postMessage({ type: 'read', id, buffer, width: image.width, height: image.height, cylinder, ...this.settings }, [buffer]);
      });
    } finally {
      this.busy = false;
    }
  }

  /** Starts loading the models early (after the bottle detector is up). */
  warmUp() { if (!this.worker && !this.failed) void this.start().catch(() => { /* cloud read carries on */ }); }

  dispose() {
    for (const waiting of this.pending.values()) { clearTimeout(waiting.timer); waiting.reject(new Error('disposed')); }
    this.pending.clear();
    try { this.worker?.postMessage({ type: 'dispose', id: -1 }); } catch { /* already gone */ }
    this.worker?.terminate();
    this.worker = null;
  }
}
