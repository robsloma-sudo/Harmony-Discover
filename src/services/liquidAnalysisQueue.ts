import { createLiquidLevelWorker, type LiquidBoundaryCandidate } from './liquidLevelDetector';
import type { LiquidOpticalAssessment } from './liquidOptics';

export type LiquidTrackCrop = {
  trackId: number;
  bounds: { x: number; y: number; width: number; height: number };
};

export type LiquidWorkerResult = {
  trackId: number;
  result: LiquidBoundaryCandidate;
  optical: LiquidOpticalAssessment;
};

type LiquidWorkerMessage = {
  id: number;
  timestamp: number;
  results?: LiquidWorkerResult[];
  error?: string;
  processingMs?: number;
};

type PendingJob = {
  id: number;
  timestamp: number;
  frame: ImageData;
  tracks: LiquidTrackCrop[];
};

/**
 * A single-flight, latest-frame-wins worker queue.
 *
 * It transfers the already captured segmentation frame to a dedicated Web
 * Worker. At most one job runs and one newer job waits; intermediate frames
 * are dropped. No synchronous liquid pixel analysis runs on the UI thread.
 */
export class LiquidAnalysisQueue {
  private worker: Worker | null;
  private inFlight = false;
  private pending: PendingJob | null = null;
  private nextId = 1;
  private lastSubmittedAt = 0;
  private disposed = false;
  private jobsDispatched = 0;
  private jobsCompleted = 0;
  private framesSkipped = 0;
  private workerErrors = 0;
  private lastWorkerMs = 0;
  private maxWorkerMs = 0;
  private readonly onResults: (timestamp: number, results: LiquidWorkerResult[]) => void;

  constructor(
    onResults: (timestamp: number, results: LiquidWorkerResult[]) => void,
    workerFactory: () => Worker | null = createLiquidLevelWorker,
  ) {
    this.onResults = onResults;
    this.worker = workerFactory();
    if (this.worker) {
      this.worker.onmessage = (event: MessageEvent<LiquidWorkerMessage>) => {
        const message = event.data;
        this.inFlight = false;
        if (message.error) this.workerErrors += 1;
        if (!this.disposed && !message.error && Array.isArray(message.results)
          && Date.now() - message.timestamp <= 1400) {
          this.jobsCompleted += 1;
          this.lastWorkerMs = Number.isFinite(message.processingMs) ? message.processingMs! : 0;
          this.maxWorkerMs = Math.max(this.maxWorkerMs, this.lastWorkerMs);
          this.onResults(message.timestamp, message.results);
        } else if (!message.error) {
          this.framesSkipped += 1;
        }
        this.processPending();
      };
      this.worker.onerror = () => {
        this.workerErrors += 1;
        this.worker?.terminate();
        this.worker = null;
        this.pending = null;
        this.inFlight = false;
      };
    }
  }

  get metrics() {
    return {
      jobsDispatched: this.jobsDispatched,
      jobsCompleted: this.jobsCompleted,
      framesSkipped: this.framesSkipped,
      workerErrors: this.workerErrors,
      lastWorkerMs: this.lastWorkerMs,
      maxWorkerMs: this.maxWorkerMs,
    };
  }

  get available(): boolean {
    return !!this.worker && !this.disposed;
  }

  submit(frame: ImageData, timestamp: number, tracks: LiquidTrackCrop[]): void {
    if (!this.available || this.disposed || !tracks.length || timestamp - this.lastSubmittedAt < 650) {
      this.framesSkipped += 1;
      return;
    }
    const buffer = frame.data.buffer;
    if (!(buffer instanceof ArrayBuffer)) return;
    this.lastSubmittedAt = timestamp;
    const job: PendingJob = {
      id: this.nextId++,
      timestamp,
      frame,
      // Limit background work to the four clearest tracked bottle regions.
      tracks: [...tracks]
        .filter(track => track.bounds.width >= 0.035 && track.bounds.height >= 0.08)
        .sort((a, b) => (b.bounds.width * b.bounds.height) - (a.bounds.width * a.bounds.height))
        .slice(0, 4),
    };
    if (!job.tracks.length) { this.framesSkipped += 1; return; }
    if (this.inFlight) {
      // Replace stale queued work instead of building latency under load.
      if (this.pending) this.framesSkipped += 1;
      this.pending = job;
      return;
    }
    this.run(job);
  }

  private run(job: PendingJob): void {
    const worker = this.worker;
    if (!worker || this.disposed || Date.now() - job.timestamp > 1000) {
      this.framesSkipped += 1;
      this.processPending();
      return;
    }
    const buffer = job.frame.data.buffer;
    if (!(buffer instanceof ArrayBuffer)) {
      this.framesSkipped += 1;
      this.processPending();
      return;
    }
    this.inFlight = true;
    this.jobsDispatched += 1;
    try {
      worker.postMessage({
        id: job.id,
        timestamp: job.timestamp,
        width: job.frame.width,
        height: job.frame.height,
        buffer,
        tracks: job.tracks,
      }, [buffer]);
    } catch {
      this.workerErrors += 1;
      this.inFlight = false;
      worker.terminate();
      this.worker = null;
      this.pending = null;
    }
  }

  private processPending(): void {
    if (this.disposed || this.inFlight || !this.pending) return;
    const next = this.pending;
    this.pending = null;
    if (Date.now() - next.timestamp <= 1000) this.run(next);
    else this.framesSkipped += 1;
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
    this.inFlight = false;
  }
}
