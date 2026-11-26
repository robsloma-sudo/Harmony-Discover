/**
 * Where option A's pieces sit on face L, and how a FacePose becomes piece opacities and head moves. Pure, tested.
 * Boxes are fractions (0..1) of the square face; they come from scripts/marty-face-rig.py (re-run it to re-cut).
 */
import { MOUTH_SHAPES, type FacePose, type MouthShape } from './facePose';

export interface Box { x: number; y: number; w: number; h: number }
const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x: x0 / 416, y: y0 / 416, w: (x1 - x0) / 416, h: (y1 - y0) / 416 });

export const MOUTH_BOX = box(110, 258, 334, 416);
export const BROW_BOXES = { scowl: box(104, 140, 320, 200), browUp: box(104, 136, 320, 200), browOne: box(218, 134, 320, 200) } as const;
export const SQUINT_BOX = box(118, 180, 312, 234);
/** Same box as face L's closed-eyelid piece (photoFaceLayout BLINK_BOX). */
export const LIDS_BOX: Box = { x: 0.334, y: 0.435, w: 146 / 416, h: 27 / 416 };

/**
 * Stacked pieces shown with opacity give an exact weighted mix when each layer's opacity is its weight divided by
 * the running total (base photo included): opacity_i = w_i / (w_base + w_1 + ... + w_i).
 */
export function layerOpacities(weights: number[]): number[] {
  const ws = weights.map(w => (Number.isFinite(w) ? Math.max(0, w) : 0));
  const sum = ws.reduce((a, b) => a + b, 0);
  const scale = sum > 1 ? 1 / sum : 1;
  let run = Math.max(0, 1 - sum * scale); // base photo weight
  return ws.map(w => { const v = w * scale; run += v; return run > 1e-6 ? v / run : 0; });
}

export function mouthOpacities(pose: FacePose): Record<MouthShape, number> {
  const ops = layerOpacities(MOUTH_SHAPES.map(k => pose.mouth[k]));
  const out = {} as Record<MouthShape, number>;
  MOUTH_SHAPES.forEach((k, i) => { out[k] = ops[i]; });
  return out;
}

/** Brows: scowl and both-up share one area, one-brow sits on top. */
export function browOpacities(pose: FacePose): { scowl: number; browUp: number; browOne: number } {
  const [scowl, browUp] = layerOpacities([pose.scowl, pose.browUp]);
  return { scowl, browUp, browOne: Math.max(0, Math.min(1, pose.browOne)) };
}

export interface HeadMove { translateX: number; translateY: number; scale: number; rotateDeg: number }
/** Head moves in px for a face of `size`: nods dip and shrink a hair, turns slide, breathing swells. */
export function headMove(pose: FacePose, size: number): HeadMove {
  return {
    translateX: pose.turn * 0.012 * size,
    translateY: (pose.nod * 0.014 + pose.breath * 0.006) * size,
    scale: 1.06 * (1 + pose.breath * 0.01 - pose.nod * 0.006),
    rotateDeg: Math.max(-8, Math.min(8, pose.tilt)),
  };
}
