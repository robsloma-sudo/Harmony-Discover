import { assessLiquidOpticalVisibility } from './liquidOptics';
/**
 * Fast, local liquid-interface candidate detector.
 *
 * This is a deliberately conservative pixel-analysis baseline. It does not
 * classify bottles or estimate volume. It searches a supplied bottle crop for
 * a horizontal colour transition supported across multiple interior columns.
 * Callers must provide bottle bounds from an independently confirmed track.
 *
 * Confidence is a ranking score, not a calibrated probability. Do not persist
 * a volume estimate from a single frame; fuse distinct frames and require
 * bottle-profile calibration first.
 */
export type PixelFrame = {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
};

export type PixelBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OcclusionBand = { top: number; bottom: number };

export type LiquidBoundaryCandidate =
  | {
      status: 'candidate';
      /** Liquid height measured from the bottom of the supplied bottle bounds. */
      normalizedHeight: number;
      /** Heuristic score in [0, 1], not a calibrated probability. */
      confidence: number;
      contrast: number;
      columnSupport: number;
      boundaryShape: 'flat' | 'curved' | 'irregular';
      shapeSpread: number;
      curvature: number;
      method: 'multi_column_lab_transition';
    }
  | {
      status: 'insufficient_evidence';
      reason: string;
      method: 'multi_column_lab_transition';
    };

type Lab = { l: number; a: number; b: number };

const COLUMN_FRACTIONS = [0.18, 0.29, 0.40, 0.50, 0.60, 0.71, 0.82];
const WINDOW_RADIUS = 3;
const MIN_DELTA_E = 7;
const MIN_COLUMN_SUPPORT = 0.42;

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750);
  const z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
  const f = (v: number) => v > 0.008856451679 ? Math.cbrt(v) : 7.787037037 * v + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function meanLab(frame: PixelFrame, x: number, fromY: number, toY: number): Lab | null {
  let r = 0, g = 0, b = 0, count = 0;
  const left = Math.max(0, Math.min(frame.width - 1, Math.round(x)));
  const top = Math.max(0, fromY);
  const bottom = Math.min(frame.height - 1, toY);
  for (let y = top; y <= bottom; y += 1) {
    const offset = (y * frame.width + left) * 4;
    const alpha = frame.data[offset + 3] ?? 255;
    if (alpha < 32) continue;
    r += frame.data[offset];
    g += frame.data[offset + 1];
    b += frame.data[offset + 2];
    count += 1;
  }
  return count ? rgbToLab(r / count, g / count, b / count) : null;
}

function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b);
}

function isOccluded(normalizedY: number, bands: OcclusionBand[]): boolean {
  return bands.some(band => normalizedY >= band.top && normalizedY <= band.bottom);
}

export function detectLiquidBoundaryCandidate(
  frame: PixelFrame,
  bounds: PixelBounds,
  options: {
    occlusionBands?: OcclusionBand[];
    minContrast?: number;
    minColumnSupport?: number;
  } = {},
): LiquidBoundaryCandidate {
  const invalid = !frame || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) ||
    frame.width < 8 || frame.height < 12 || !frame.data ||
    frame.data.length < frame.width * frame.height * 4 ||
    !bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width < 8 || bounds.height < 12;
  if (invalid) {
    return { status: 'insufficient_evidence', reason: 'Invalid image frame or bottle bounds.', method: 'multi_column_lab_transition' };
  }

  const left = Math.max(0, Math.floor(bounds.x));
  const right = Math.min(frame.width, Math.ceil(bounds.x + bounds.width));
  const top = Math.max(0, Math.floor(bounds.y));
  const bottom = Math.min(frame.height, Math.ceil(bounds.y + bounds.height));
  const width = right - left;
  const height = bottom - top;
  if (width < 8 || height < 12) {
    return { status: 'insufficient_evidence', reason: 'Bottle crop is outside the image or too small.', method: 'multi_column_lab_transition' };
  }

  const occlusions = options.occlusionBands ?? [];
  const minContrast = options.minContrast ?? MIN_DELTA_E;
  const minSupport = options.minColumnSupport ?? MIN_COLUMN_SUPPORT;
  if (!Number.isFinite(minContrast) || minContrast <= 0 ||
      !Number.isFinite(minSupport) || minSupport <= 0 || minSupport > 1 ||
      occlusions.some(b => !Number.isFinite(b.top) || !Number.isFinite(b.bottom) || b.top < 0 || b.bottom > 1 || b.bottom < b.top)) {
    return { status: 'insufficient_evidence', reason: 'Invalid detector thresholds or occlusion bands.', method: 'multi_column_lab_transition' };
  }

  const columns = COLUMN_FRACTIONS.map(fraction => left + fraction * (width - 1));
  let best = { y: -1, contrast: 0, support: 0 };
  const firstY = top + Math.max(4, Math.floor(height * 0.08));
  const lastY = bottom - Math.max(4, Math.floor(height * 0.04));

  for (let y = firstY; y <= lastY; y += 1) {
    const normalizedY = (y - top) / height;
    if (isOccluded(normalizedY, occlusions)) continue;
    const contrasts: number[] = [];
    for (const x of columns) {
      const above = meanLab(frame, x, y - WINDOW_RADIUS, y - 1);
      const below = meanLab(frame, x, y + 1, y + WINDOW_RADIUS);
      if (above && below) contrasts.push(deltaE(above, below));
    }
    if (contrasts.length < Math.ceil(columns.length * minSupport)) continue;
    const supported = contrasts.filter(value => value >= minContrast).length / columns.length;
    const sorted = [...contrasts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const score = median * supported;
    if (supported >= minSupport && score > best.contrast * best.support) {
      best = { y, contrast: median, support: supported };
    }
  }

  if (best.y < 0 || best.contrast < minContrast || best.support < minSupport) {
    return { status: 'insufficient_evidence', reason: 'No stable horizontal transition was supported across enough bottle columns.', method: 'multi_column_lab_transition' };
  }

  // Refine the interface independently in each interior column. This lets
  // a real curved meniscus survive when its center and edges sit at different
  // heights, while rejecting highly irregular transitions.
  const searchRadius = Math.max(4, Math.round(height * 0.12));
  const columnSamples: Array<{ x: number; y: number }> = [];
  for (const x of columns) {
    let strongest = { y: -1, contrast: 0 };
    const from = Math.max(firstY, best.y - searchRadius);
    const to = Math.min(lastY, best.y + searchRadius);
    for (let y = from; y <= to; y += 1) {
      if (isOccluded((y - top) / height, occlusions)) continue;
      const above = meanLab(frame, x, y - WINDOW_RADIUS, y - 1);
      const below = meanLab(frame, x, y + 1, y + WINDOW_RADIUS);
      if (!above || !below) continue;
      const contrast = deltaE(above, below);
      if (contrast > strongest.contrast) strongest = { y, contrast };
    }
    if (strongest.y >= 0 && strongest.contrast >= minContrast) columnSamples.push({ x, y: strongest.y });
  }
  const sortedHeights = columnSamples.map(sample => sample.y).sort((a, b) => a - b);
  const spatialSamples = [...columnSamples].sort((a, b) => a.x - b.x);
  const medianY = sortedHeights.length
    ? sortedHeights[Math.floor(sortedHeights.length / 2)]
    : best.y;
  const shapeSpread = sortedHeights.length >= 4
    ? (sortedHeights[sortedHeights.length - 1] - sortedHeights[0]) / height
    : 0;
  const centerValues = spatialSamples.length >= 5 ? spatialSamples.slice(2, -2).map(sample => sample.y) : sortedHeights;
  const edgeValues = spatialSamples.length >= 5 ? [spatialSamples[0].y, spatialSamples[1].y, spatialSamples[spatialSamples.length - 2].y, spatialSamples[spatialSamples.length - 1].y] : sortedHeights;
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const curvature = (average(centerValues) - average(edgeValues)) / height;
  const boundaryShape: 'flat' | 'curved' | 'irregular' =
    shapeSpread <= 0.025 ? 'flat' :
    shapeSpread <= 0.14 && Math.abs(curvature) >= 0.008 ? 'curved' : 'irregular';
  const confidence = Math.max(0, Math.min(1, (best.contrast / 28) * best.support));
  return {
    status: 'candidate',
    normalizedHeight: Math.max(0, Math.min(1, (bottom - medianY) / height)),
    confidence,
    contrast: best.contrast,
    columnSupport: best.support,
    boundaryShape,
    shapeSpread,
    curvature,
    method: 'multi_column_lab_transition',
  };
}


/**
 * Creates a dedicated browser worker for pixel analysis. The worker source is
 * assembled from the same detector functions used by unit tests, so the
 * background implementation cannot silently drift from the tested baseline.
 * Returns null when workers are unavailable; callers must then abstain rather
 * than running this CPU work on the camera/UI thread.
 */
export function createLiquidLevelWorker(): Worker | null {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return null;
  }
  const source = [
    `const COLUMN_FRACTIONS = ${JSON.stringify(COLUMN_FRACTIONS)};`,
    `const WINDOW_RADIUS = ${WINDOW_RADIUS};`,
    `const MIN_DELTA_E = ${MIN_DELTA_E};`,
    `const MIN_COLUMN_SUPPORT = ${MIN_COLUMN_SUPPORT};`,
    srgbToLinear.toString(),
    rgbToLab.toString(),
    meanLab.toString(),
    deltaE.toString(),
    isOccluded.toString(),
    detectLiquidBoundaryCandidate.toString(),
    assessLiquidOpticalVisibility.toString(),
    `self.onmessage = (event) => {
      const job = event.data;
      const startedAt = performance.now();
      try {
        const frame = { width: job.width, height: job.height, data: new Uint8ClampedArray(job.buffer) };
        const results = job.tracks.map((track) => ({
          trackId: track.trackId,
          optical: assessLiquidOpticalVisibility(frame, track.bounds),
          result: detectLiquidBoundaryCandidate(frame, track.bounds),
        }));
        self.postMessage({ id: job.id, timestamp: job.timestamp, results, processingMs: performance.now() - startedAt });
      } catch (error) {
        self.postMessage({ id: job.id, timestamp: job.timestamp, error: error instanceof Error ? error.message : 'liquid_worker_failed' });
      }
    };`,
  ].join('\n');
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    const worker = new Worker(url);
    worker.addEventListener('message', () => URL.revokeObjectURL(url), { once: true });
    worker.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
    return worker;
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}
