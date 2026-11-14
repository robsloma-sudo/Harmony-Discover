/**
 * Whole-frame camera motion for the web scanner.
 *
 * The phone browser has no ARKit pose, so bottle boxes are carried between
 * detector passes by image motion. A coarse-to-fine (pyramidal) Lucas-Kanade
 * tracker follows a grid of points across the frame and fits one
 * translation + zoom model. That one model moves every remembered bottle,
 * including bottles that are currently off screen, so they are back in the
 * right place when the camera returns.
 *
 * Coordinates are normalized to the visible (object-fit: cover) camera crop.
 * A motion maps a point p in the previous frame to s * (p - 0.5) + 0.5 + t.
 */

export type GrayLevel = { data: Uint8Array; width: number; height: number; gx: Float32Array; gy: Float32Array };
export type GrayPyramid = GrayLevel[];

export type CameraMotion = {
  /** Horizontal translation, as a fraction of frame width. */
  tx: number;
  /** Vertical translation, as a fraction of frame height. */
  ty: number;
  /** Zoom about the frame centre (1 = no zoom). */
  scale: number;
};

export type CameraMotionEstimate = CameraMotion & { quality: number; inliers: number; tracked: number };

export const IDENTITY_MOTION: CameraMotion = Object.freeze({ tx: 0, ty: 0, scale: 1 });

export type Box = { x: number; y: number; width: number; height: number };

function gradients(data: Uint8Array, width: number, height: number, reuse?: GrayLevel): { gx: Float32Array; gy: Float32Array } {
  // Reused buffers keep the per-frame garbage near zero (phones kill pages
  // that churn memory); borders stay zero as in a fresh buffer.
  const gx = reuse && reuse.gx.length === width * height ? reuse.gx : new Float32Array(width * height);
  const gy = reuse && reuse.gy.length === width * height ? reuse.gy : new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      gx[i] = (data[i + 1]! - data[i - 1]!) * 0.5;
      gy[i] = (data[i + width]! - data[i - width]!) * 0.5;
    }
  }
  return { gx, gy };
}

/**
 * Builds a gray image pyramid (level 0 = full size, each next level half size).
 * Pass a no-longer-needed pyramid of the same size as `recycle` to reuse its memory.
 */
export function buildGrayPyramid(gray: Uint8Array, width: number, height: number, maxLevels = 4, recycle?: GrayPyramid | null): GrayPyramid {
  if (gray.length !== width * height || width < 8 || height < 8) return [];
  const reuse = recycle && recycle[0]?.width === width && recycle[0]?.height === height ? recycle : null;
  const levels: GrayPyramid = [{ data: gray, width, height, ...gradients(gray, width, height, reuse?.[0]) }];
  while (levels.length < maxLevels) {
    const previous = levels[levels.length - 1]!;
    const w = previous.width >> 1, h = previous.height >> 1;
    if (w < 20 || h < 20) break;
    const old = reuse?.[levels.length];
    const data = old && old.data.length === w * h ? old.data : new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const r0 = (y * 2) * previous.width, r1 = r0 + previous.width;
      for (let x = 0; x < w; x++) {
        const c = x * 2;
        data[y * w + x] = (previous.data[r0 + c]! + previous.data[r0 + c + 1]! + previous.data[r1 + c]! + previous.data[r1 + c + 1]! + 2) >> 2;
      }
    }
    levels.push({ data, width: w, height: h, ...gradients(data, w, h, old) });
  }
  return levels;
}

function bilinear(image: Uint8Array | Float32Array, width: number, height: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x > width - 2 || y > height - 2) return Number.NaN;
  const x0 = x | 0, y0 = y | 0;
  const fx = x - x0, fy = y - y0;
  const i = y0 * width + x0;
  const a = image[i]!, b = image[i + 1]!, c = image[i + width]!, d = image[i + width + 1]!;
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

const WINDOW_RADIUS = 3;
const WINDOW_SIZE = (WINDOW_RADIUS * 2 + 1) ** 2;
// Scratch buffers (single-threaded use) so tracking allocates nothing per point.
const TEMPLATE = new Float32Array(WINDOW_SIZE);
const TEMPLATE_GX = new Float32Array(WINDOW_SIZE);
const TEMPLATE_GY = new Float32Array(WINDOW_SIZE);

/**
 * Tracks one point from `previous` to `current`, starting from a guessed
 * displacement (level-0 pixels). Returns the level-0 displacement, or null when
 * the point has too little texture or does not converge.
 */
export function trackPointPyramidal(
  previous: GrayPyramid,
  current: GrayPyramid,
  px: number,
  py: number,
  guessDx = 0,
  guessDy = 0,
): { dx: number; dy: number; error: number } | null {
  const levels = Math.min(previous.length, current.length);
  if (!levels) return null;
  const template = TEMPLATE, tgx = TEMPLATE_GX, tgy = TEMPLATE_GY;
  let dx = guessDx / 2 ** (levels - 1);
  let dy = guessDy / 2 ** (levels - 1);
  let finalError = 0;
  for (let level = levels - 1; level >= 0; level--) {
    const prev = previous[level]!, cur = current[level]!;
    const factor = 2 ** level;
    const lx = px / factor, ly = py / factor;
    let gxx = 0, gxy = 0, gyy = 0, n = 0;
    for (let oy = -WINDOW_RADIUS, k = 0; oy <= WINDOW_RADIUS; oy++) {
      for (let ox = -WINDOW_RADIUS; ox <= WINDOW_RADIUS; ox++, k++) {
        const value = bilinear(prev.data, prev.width, prev.height, lx + ox, ly + oy);
        if (!Number.isFinite(value)) { template[k] = Number.NaN; continue; }
        const ix = bilinear(prev.gx, prev.width, prev.height, lx + ox, ly + oy);
        const iy = bilinear(prev.gy, prev.width, prev.height, lx + ox, ly + oy);
        template[k] = value; tgx[k] = ix; tgy[k] = iy;
        gxx += ix * ix; gxy += ix * iy; gyy += iy * iy; n++;
      }
    }
    const determinant = gxx * gyy - gxy * gxy;
    // Minimum eigenvalue gate: reject flat or single-edge (aperture) windows.
    const trace = gxx + gyy;
    const minEigen = (trace - Math.sqrt(Math.max(0, trace * trace - 4 * determinant))) / 2;
    if (n < WINDOW_SIZE * 0.6 || minEigen / Math.max(1, n) < 4) {
      if (level === 0) return null;
      dx *= 2; dy *= 2;
      continue;
    }
    for (let iteration = 0; iteration < 8; iteration++) {
      let bx = 0, by = 0, error = 0, samples = 0;
      for (let oy = -WINDOW_RADIUS, k = 0; oy <= WINDOW_RADIUS; oy++) {
        for (let ox = -WINDOW_RADIUS; ox <= WINDOW_RADIUS; ox++, k++) {
          const t = template[k]!;
          if (!Number.isFinite(t)) continue;
          const value = bilinear(cur.data, cur.width, cur.height, lx + dx + ox, ly + dy + oy);
          if (!Number.isFinite(value)) continue;
          const diff = value - t;
          bx += tgx[k]! * diff; by += tgy[k]! * diff;
          error += Math.abs(diff); samples++;
        }
      }
      if (samples < WINDOW_SIZE * 0.5) return null;
      const stepX = (-gyy * bx + gxy * by) / determinant;
      const stepY = (gxy * bx - gxx * by) / determinant;
      if (!Number.isFinite(stepX) || !Number.isFinite(stepY)) return null;
      dx += stepX; dy += stepY;
      finalError = error / samples;
      if (Math.abs(stepX) + Math.abs(stepY) < 0.03) break;
    }
    if (level > 0) { dx *= 2; dy *= 2; }
  }
  if (finalError > 30) return null;
  return { dx, dy, error: finalError };
}

const median = (values: number[]): number => {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

type Correspondence = { x: number; y: number; dx: number; dy: number };

function fitTranslationScale(points: Correspondence[], cx: number, cy: number): { tx: number; ty: number; scale: number } {
  // Least squares for p' - c = s (p - c) + t.
  let qx = 0, qy = 0, rx = 0, ry = 0;
  for (const p of points) { qx += p.x - cx; qy += p.y - cy; rx += p.x + p.dx - cx; ry += p.y + p.dy - cy; }
  qx /= points.length; qy /= points.length; rx /= points.length; ry /= points.length;
  let numerator = 0, denominator = 0;
  for (const p of points) {
    const ax = p.x - cx - qx, ay = p.y - cy - qy;
    const bx = p.x + p.dx - cx - rx, by = p.y + p.dy - cy - ry;
    numerator += ax * bx + ay * by;
    denominator += ax * ax + ay * ay;
  }
  const scale = denominator > 1e-6 ? numerator / denominator : 1;
  return { scale, tx: rx - scale * qx, ty: ry - scale * qy };
}

export type CameraMotionOptions = {
  /** Expected motion (e.g. last frame's), used as the tracker's starting guess. */
  guess?: CameraMotion;
  columns?: number;
  rows?: number;
};

/**
 * Estimates one translation + zoom for the whole frame. Returns null when too
 * few points can be followed (textureless view, heavy blur, or a cut).
 */
export function estimateCameraMotion(previous: GrayPyramid, current: GrayPyramid, options: CameraMotionOptions = {}): CameraMotionEstimate | null {
  const base = previous[0], next = current[0];
  if (!base || !next || base.width !== next.width || base.height !== next.height) return null;
  const { width, height } = base;
  const columns = options.columns ?? 8;
  const rows = options.rows ?? Math.max(6, Math.round(columns * height / width));
  const guess = options.guess ?? IDENTITY_MOTION;
  const cx = width / 2, cy = height / 2;
  const points: Correspondence[] = [];
  let tracked = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = width * (0.06 + 0.88 * (column + 0.5) / columns);
      const y = height * (0.06 + 0.88 * (row + 0.5) / rows);
      const gx = guess.scale * (x - cx) + cx + guess.tx * width - x;
      const gy = guess.scale * (y - cy) + cy + guess.ty * height - y;
      const result = trackPointPyramidal(previous, current, x, y, gx, gy);
      if (!result) continue;
      tracked++;
      points.push({ x, y, dx: result.dx, dy: result.dy });
    }
  }
  if (points.length < 8) return null;
  let model = { tx: median(points.map(p => p.dx)), ty: median(points.map(p => p.dy)), scale: 1 };
  let inliers = points;
  for (let pass = 0; pass < 3; pass++) {
    const residuals = points.map(p => Math.hypot(
      model.scale * (p.x - cx) + cx + model.tx - (p.x + p.dx),
      model.scale * (p.y - cy) + cy + model.ty - (p.y + p.dy),
    ));
    const tolerance = Math.max(0.9, Math.min(3, median(residuals) * 2.5));
    inliers = points.filter((_, index) => residuals[index]! <= tolerance);
    if (inliers.length < 6) return null;
    model = fitTranslationScale(inliers, cx, cy);
  }
  if (!Number.isFinite(model.scale) || model.scale < 0.8 || model.scale > 1.25) return null;
  const quality = inliers.length / Math.max(1, columns * rows);
  if (inliers.length < 8 || inliers.length / points.length < 0.4) return null;
  return { tx: model.tx / width, ty: model.ty / height, scale: model.scale, quality, inliers: inliers.length, tracked };
}

/**
 * Follows one box's own points, starting from where the camera motion puts
 * it. Used to correct parallax for near bottles. Returns the box centre shift
 * in normalized units relative to the camera-motion prediction.
 */
export function refineBoxMotion(previous: GrayPyramid, current: GrayPyramid, box: Box, motion: CameraMotion): { dx: number; dy: number; quality: number } | null {
  const base = previous[0];
  if (!base) return null;
  const { width, height } = base;
  const cx = width / 2, cy = height / 2;
  const residuals: Array<{ dx: number; dy: number }> = [];
  let attempted = 0;
  for (const fy of [0.25, 0.45, 0.65, 0.82]) {
    for (const fx of [0.3, 0.5, 0.7]) {
      const x = (box.x + box.width * fx) * width;
      const y = (box.y + box.height * fy) * height;
      if (x < 4 || y < 4 || x > width - 5 || y > height - 5) continue;
      attempted++;
      const gx = motion.scale * (x - cx) + cx + motion.tx * width - x;
      const gy = motion.scale * (y - cy) + cy + motion.ty * height - y;
      const result = trackPointPyramidal(previous, current, x, y, gx, gy);
      if (result) residuals.push({ dx: (result.dx - gx) / width, dy: (result.dy - gy) / height });
    }
  }
  if (residuals.length < 4) return null;
  const mx = median(residuals.map(r => r.dx)), my = median(residuals.map(r => r.dy));
  const inliers = residuals.filter(r => Math.hypot((r.dx - mx) * width, (r.dy - my) * height) <= 2);
  if (inliers.length < 4) return null;
  return { dx: median(inliers.map(r => r.dx)), dy: median(inliers.map(r => r.dy)), quality: inliers.length / Math.max(1, attempted) };
}

export function applyMotionToPoint(point: { x: number; y: number }, motion: CameraMotion): { x: number; y: number } {
  return { x: motion.scale * (point.x - 0.5) + 0.5 + motion.tx, y: motion.scale * (point.y - 0.5) + 0.5 + motion.ty };
}

export function applyMotionToBox<T extends Box>(box: T, motion: CameraMotion): T {
  const topLeft = applyMotionToPoint(box, motion);
  return { ...box, x: topLeft.x, y: topLeft.y, width: box.width * motion.scale, height: box.height * motion.scale };
}

/** Motion `second` applied after `first`. */
export function composeMotion(first: CameraMotion, second: CameraMotion): CameraMotion {
  return { scale: first.scale * second.scale, tx: second.scale * first.tx + second.tx, ty: second.scale * first.ty + second.ty };
}

export function invertMotion(motion: CameraMotion): CameraMotion {
  const scale = 1 / motion.scale;
  return { scale, tx: -motion.tx * scale, ty: -motion.ty * scale };
}

/** Fraction of a box's area that lies inside the visible frame. */
export function visibleFraction(box: Box): number {
  const area = box.width * box.height;
  if (!(area > 0)) return 0;
  const w = Math.max(0, Math.min(1, box.x + box.width) - Math.max(0, box.x));
  const h = Math.max(0, Math.min(1, box.y + box.height) - Math.max(0, box.y));
  return (w * h) / area;
}

export function clipBoxToFrame<T extends Box>(box: T): T {
  const x0 = Math.max(0, box.x), y0 = Math.max(0, box.y);
  const x1 = Math.min(1, box.x + box.width), y1 = Math.min(1, box.y + box.height);
  return { ...box, x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/**
 * Cumulative camera motion over time. Detector and cloud results describe the
 * frame they were captured from; `motionSince(t)` moves them into today's view.
 */
export class CameraMotionHistory {
  private entries: Array<{ at: number; total: CameraMotion }> = [];
  private total: CameraMotion = IDENTITY_MOTION;
  private speeds: Array<{ at: number; speed: number }> = [];

  constructor(private readonly retentionMs = 8_000) {}

  record(at: number, motion: CameraMotion, elapsedMs: number): void {
    this.total = composeMotion(this.total, motion);
    this.entries.push({ at, total: this.total });
    const distance = Math.hypot(motion.tx, motion.ty) + Math.abs(Math.log(motion.scale));
    this.speeds.push({ at, speed: elapsedMs > 0 ? distance / (elapsedMs / 1000) : 0 });
    const cutoff = at - this.retentionMs;
    while (this.entries.length > 2 && this.entries[0]!.at < cutoff) this.entries.shift();
    while (this.speeds.length > 2 && this.speeds[0]!.at < cutoff) this.speeds.shift();
  }

  private totalAt(at: number): CameraMotion | null {
    if (!this.entries.length) return IDENTITY_MOTION;
    if (at < this.entries[0]!.at - 50) return null;
    let result = this.entries[0]!.total;
    for (const entry of this.entries) {
      if (entry.at > at) break;
      result = entry.total;
    }
    return result;
  }

  /** Motion from time `at` to now, or null when history does not reach back that far. */
  motionSince(at: number): CameraMotion | null {
    const then = this.totalAt(at);
    if (!then) return null;
    return composeMotion(invertMotion(then), this.total);
  }

  /** Highest camera speed (frame-widths per second) recorded in [from, to]. */
  peakSpeed(from: number, to: number): number {
    let peak = 0;
    for (const entry of this.speeds) if (entry.at >= from && entry.at <= to) peak = Math.max(peak, entry.speed);
    return peak;
  }

  reset(): void {
    this.entries = [];
    this.speeds = [];
    this.total = IDENTITY_MOTION;
  }
}
