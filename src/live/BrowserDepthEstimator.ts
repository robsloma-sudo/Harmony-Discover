export type RelativeDepthMap = {
  width: number;
  height: number;
  /** Normalized inverse relative depth: 1 nearer, 0 farther. Not metres. */
  values: Float32Array;
  relative: true;
  inferenceMs: number;
  model: string;
};

type WorkerMessage =
  | { type: 'status'; status: 'loading' }
  | { type: 'depth'; width: number; height: number; values: ArrayBuffer; relative: true; inferenceMs: number; model: string }
  | { type: 'error'; message: string };

export class BrowserDepthEstimator {
  private worker: Worker | null = null;
  private pending = false;
  private disposed = false;
  private failed = false;
  private lastSubmittedAt = 0;
  private onDepth: (depth: RelativeDepthMap) => void;
  private onStatus: (status: string) => void;

  constructor(onDepth: (depth: RelativeDepthMap) => void, onStatus: (status: string) => void) {
    this.onDepth = onDepth;
    this.onStatus = onStatus;
  }

  start() {
    if (this.disposed || this.worker || typeof window === 'undefined' || typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker('/discover-depth-worker.js', { type: 'module', name: 'discover-relative-depth' });
      this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === 'status') { this.onStatus('Loading on-device depth model…'); return; }
        if (message.type === 'error') { this.pending = false; this.failed = true; this.onStatus('Depth model unavailable: ' + message.message); return; }
        if (message.type === 'depth') {
          this.pending = false;
          this.onDepth({ width: message.width, height: message.height, values: new Float32Array(message.values), relative: true, inferenceMs: message.inferenceMs, model: message.model });
          this.onStatus('Relative depth active · ' + message.inferenceMs + ' ms');
        }
      };
      this.worker.onerror = () => { this.pending = false; this.failed = true; this.onStatus('Depth worker failed to load.'); };
      this.onStatus('Depth worker ready; model loads on first frame.');
    } catch {
      this.onStatus('This browser cannot start the depth worker.');
    }
  }

  submit(video: HTMLVideoElement) {
    if (this.disposed || this.failed || !this.worker || this.pending || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const now = Date.now();
    if (now - this.lastSubmittedAt < 1600) return;
    this.lastSubmittedAt = now;
    this.pending = true;
    // Crop to the same object-fit:cover viewport shown to the user.
    const displayWidth = video.clientWidth || video.videoWidth;
    const displayHeight = video.clientHeight || video.videoHeight;
    const displayAspect = displayWidth / displayHeight;
    const sourceAspect = video.videoWidth / video.videoHeight;
    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
    if (sourceAspect > displayAspect) { sw = video.videoHeight * displayAspect; sx = (video.videoWidth - sw) / 2; }
    else if (sourceAspect < displayAspect) { sh = video.videoWidth / displayAspect; sy = (video.videoHeight - sh) / 2; }
    const scale = Math.min(1, 518 / Math.max(sw, sh));
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: false });
    if (!context) { this.pending = false; return; }
    context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
    if (typeof canvas.toBlob !== 'function') {
      this.pending = false;
      this.onStatus('Canvas image conversion is unavailable in this browser.');
      return;
    }
    canvas.toBlob(blob => {
      if (!blob || this.disposed || !this.worker) { this.pending = false; return; }
      this.worker.postMessage({ type: 'infer', blob });
    }, 'image/jpeg', .72);
  }

  dispose() {
    this.disposed = true;
    this.pending = false;
    this.worker?.terminate();
    this.worker = null;
  }
}
