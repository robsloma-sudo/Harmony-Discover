import { describe, expect, it } from 'vitest';
import {
  CameraMotionHistory,
  applyMotionToBox,
  buildGrayPyramid,
  clipBoxToFrame,
  composeMotion,
  estimateCameraMotion,
  invertMotion,
  refineBoxMotion,
  visibleFraction,
} from '../src/live/cameraMotion';

// A shelf-like textured scene sampled at continuous coordinates so that any
// translation and zoom can be rendered exactly.
const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
// Smooth value noise at several scales: aperiodic like a real shelf, with
// both coarse structure (bottles, labels) and fine detail (print).
const noise = (x: number, y: number, cell: number) => {
  const gx = x / cell, gy = y / cell;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};
const scene = (x: number, y: number) =>
  40 + noise(x, y, 40) * 90 + noise(x + 1000, y, 14) * 70 + noise(x, y + 1000, 5) * 45;

function render(width: number, height: number, tx = 0, ty = 0, scale = 1): Uint8Array {
  const frame = new Uint8Array(width * height);
  const cx = width / 2, cy = height / 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // Pixel (x, y) of the new frame shows scene point p where x = s (p - c) + c + t.
    const sx = (x - cx - tx) / scale + cx;
    const sy = (y - cy - ty) / scale + cy;
    frame[y * width + x] = Math.max(0, Math.min(255, Math.round(scene(sx, sy))));
  }
  return frame;
}

describe('pyramidal whole-frame camera motion', () => {
  const width = 180, height = 320;
  const before = buildGrayPyramid(render(width, height), width, height);

  it('recovers a small pan', () => {
    const after = buildGrayPyramid(render(width, height, 3, -2), width, height);
    const motion = estimateCameraMotion(before, after)!;
    expect(motion).not.toBeNull();
    expect(motion.tx * width).toBeCloseTo(3, 0);
    expect(motion.ty * height).toBeCloseTo(-2, 0);
    expect(motion.scale).toBeCloseTo(1, 2);
  });

  it('recovers a fast pan that single-scale flow cannot follow', () => {
    const after = buildGrayPyramid(render(width, height, 19, 11), width, height);
    const motion = estimateCameraMotion(before, after)!;
    expect(motion).not.toBeNull();
    expect(Math.abs(motion.tx * width - 19)).toBeLessThan(1);
    expect(Math.abs(motion.ty * height - 11)).toBeLessThan(1);
  });

  it('recovers zoom when the phone moves closer', () => {
    const after = buildGrayPyramid(render(width, height, 0, 0, 1.06), width, height);
    const motion = estimateCameraMotion(before, after)!;
    expect(motion).not.toBeNull();
    expect(motion.scale).toBeGreaterThan(1.04);
    expect(motion.scale).toBeLessThan(1.08);
  });

  it('uses the previous motion as a guess for very fast pans', () => {
    const after = buildGrayPyramid(render(width, height, 34, 0), width, height);
    const motion = estimateCameraMotion(before, after, { guess: { tx: 30 / width, ty: 0, scale: 1 } })!;
    expect(motion).not.toBeNull();
    expect(Math.abs(motion.tx * width - 34)).toBeLessThan(1);
  });

  it('refuses to invent motion in a textureless view', () => {
    const flat = new Uint8Array(width * height).fill(120);
    const pyramid = buildGrayPyramid(flat, width, height);
    expect(estimateCameraMotion(pyramid, pyramid)).toBeNull();
  });

  it('measures a bottle that moves differently from the background', () => {
    const after = buildGrayPyramid(render(width, height, 4, 0), width, height);
    const shift = refineBoxMotion(before, after, { x: 0.3, y: 0.3, width: 0.3, height: 0.4 }, { tx: 0, ty: 0, scale: 1 });
    expect(shift).not.toBeNull();
    expect(shift!.dx * width).toBeCloseTo(4, 0);
  });
});

describe('camera motion algebra and history', () => {
  it('composes and inverts motions', () => {
    const a = { tx: 0.1, ty: -0.05, scale: 1.1 };
    const b = { tx: -0.02, ty: 0.03, scale: 0.95 };
    const box = { x: 0.2, y: 0.3, width: 0.1, height: 0.2 };
    const sequential = applyMotionToBox(applyMotionToBox(box, a), b);
    const combined = applyMotionToBox(box, composeMotion(a, b));
    expect(combined.x).toBeCloseTo(sequential.x, 10);
    expect(combined.height).toBeCloseTo(sequential.height, 10);
    const back = applyMotionToBox(applyMotionToBox(box, a), invertMotion(a));
    expect(back.x).toBeCloseTo(box.x, 10);
    expect(back.width).toBeCloseTo(box.width, 10);
  });

  it('moves a capture-time box into the current view', () => {
    const history = new CameraMotionHistory();
    history.record(1000, { tx: 0.1, ty: 0, scale: 1 }, 33);
    history.record(1033, { tx: 0.05, ty: 0, scale: 1 }, 33);
    history.record(1066, { tx: 0.05, ty: 0.02, scale: 1 }, 33);
    const motion = history.motionSince(1010)!;
    expect(motion.tx).toBeCloseTo(0.1, 10);
    expect(motion.ty).toBeCloseTo(0.02, 10);
    expect(history.peakSpeed(1000, 1100)).toBeGreaterThan(2.9);
  });

  it('reports partly visible and off-screen boxes', () => {
    expect(visibleFraction({ x: 0.2, y: 0.2, width: 0.2, height: 0.2 })).toBe(1);
    expect(visibleFraction({ x: 0.9, y: 0.2, width: 0.2, height: 0.2 })).toBeCloseTo(0.5, 10);
    expect(visibleFraction({ x: 1.3, y: 0.2, width: 0.2, height: 0.2 })).toBe(0);
    expect(clipBoxToFrame({ x: 0.9, y: -0.1, width: 0.2, height: 0.3 })).toEqual({ x: 0.9, y: 0, width: 0.09999999999999998, height: 0.19999999999999998 });
  });
});
