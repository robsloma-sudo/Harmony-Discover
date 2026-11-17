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

/**
 * On a computer it is on by default. On phones it is OFF by default (17 Nov 2026: on an iPhone it took
 * ~0.7 s per read and slowed the bottle boxes, because it shares the phone's processor with the bottle
 * detector). Turn it on with ?ocr=on (or localStorage 'discover.ocr' = 'on'); off with ?ocr=off.
 */
export function textReaderEnabled(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  try {
    const fromUrl = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('ocr') : null;
    if (fromUrl === 'off') { try { localStorage.setItem('discover.ocr', 'off'); } catch { /* storage blocked */ } return false; }
    if (fromUrl === 'on') { try { localStorage.setItem('discover.ocr', 'on'); } catch { /* storage blocked */ } return true; }
  } catch { /* no URL */ }
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('discover.ocr') : null;
    if (stored === 'off') return false;
    if (stored === 'on') return true;
  } catch { /* storage blocked */ }
  return !/iPhone|iPad|iPod|Android|Mobile/i.test(userAgent);
}

/** Phone reads are spaced out so the bottle detector keeps the processor (ms between reads). */
export const PHONE_READ_GAP_MS = 3_000;
/** The reader only needs the biggest words: crops are shrunk to this long edge before reading. */
export const OCR_MAX_EDGE = 640;

type Reply = { type: 'ready' | 'result' | 'error'; id: number; message?: string } & Partial<TextRead>;
export type TextWorkerLike = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<Reply>) => void) | null;
  onerror: ((event: Event) => void) | null;
};

/** One worker, one read at a time; extra requests while busy are dropped (the next label batch retries). */
export class LabelTextReader {
  private worker: TextWorkerLike | null = null;
  private starting: Promise<void> | null = null;
  private failed = false;
  private busy = false;
  private nextId = 1;
  private pending = new Map<number, { resolve: (read: TextRead) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    private readonly factory: () => TextWorkerLike = () => new Worker(OCR_WORKER_URL, { type: 'module', name: 'discover-label-text' }) as unknown as TextWorkerLike,
    private readonly startTimeoutMs = 20_000,
    private readonly readTimeoutMs = 4_000,
  ) {}

  get available() { return !this.failed; }
  get isBusy() { return this.busy || !!this.starting; }

  private start(): Promise<void> {
    if (this.worker) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = new Promise<void>((resolve, reject) => {
      const worker = this.factory();
      const timer = setTimeout(() => reject(new Error('The label text reader took too long to start.')), this.startTimeoutMs);
      worker.onerror = () => { clearTimeout(timer); reject(new Error('The label text reader could not start.')); };
      worker.onmessage = event => {
        const reply = event.data;
        if (reply.id === 0) {
          clearTimeout(timer);
          if (reply.type === 'ready') { this.worker = worker; this.attach(worker); resolve(); }
          else reject(new Error(reply.message || 'The label text reader could not start.'));
        }
      };
      worker.postMessage({ type: 'init', id: 0, ...OCR_MODELS });
    }).catch(error => {
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
        worker.postMessage({ type: 'read', id, buffer, width: image.width, height: image.height, cylinder }, [buffer]);
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
