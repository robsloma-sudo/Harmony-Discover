// Pure numbers for the photo face "L" (no react-native import so vitest can cover them).
// All boxes are fractions (0..1) of the square base image.
export type PhotoFaceState = 'idle' | 'listening' | 'thinking' | 'talking';
export interface Box { x: number; y: number; w: number; h: number }

export const PHOTO_SCALE = 1.06; // photo group is scaled so small tilts never reveal a corner
export const JAW_BOX: Box = { x: 0.351, y: 0.743, w: 148 / 416, h: 97 / 416 };
export const BLINK_BOX: Box = { x: 0.334, y: 0.435, w: 146 / 416, h: 27 / 416 };
export const GAP_CENTER_X = 0.524;
export const GAP_TOP_Y = 0.743;
export const GAP_WIDTH = 0.16;
export const GAP_COLOR = '#2A0F0F';
export const MAX_JAW_SHIFT = 0.024; // fraction of size at mouthOpen 1 (about 10 px at 416)
export const GAP_EXTRA = 0.004; // gap is a little taller than the shift so no sliver shows
export const LISTENING_RED = '#FF5A4E'; // same as MartyOverlay's live colour
export const GOLD = '#C6A36A';

export function clampOpen(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}
/** Jaw drop in px for a mouthOpen at a given face size. */
export function jawShift(mouthOpen: number, size: number): number {
  return clampOpen(mouthOpen) * MAX_JAW_SHIFT * size;
}
/** Dark mouth gap height in px; 0 when closed (gap hidden). */
export function gapHeight(mouthOpen: number, size: number): number {
  const o = clampOpen(mouthOpen);
  return o === 0 ? 0 : (o * MAX_JAW_SHIFT + GAP_EXTRA) * size;
}

export interface Pose { scale: number; tiltDeg: number; ring: number; dots: number; blinks: boolean }
export const POSES: Record<PhotoFaceState, Pose> = {
  idle: { scale: 1, tiltDeg: 0, ring: 0, dots: 0, blinks: true },
  listening: { scale: 1.03, tiltDeg: 1.5, ring: 1, dots: 0, blinks: true },
  thinking: { scale: 0.97, tiltDeg: -2.5, ring: 0, dots: 1, blinks: false },
  talking: { scale: 1, tiltDeg: 0, ring: 0, dots: 0, blinks: true },
};
/** Ring thickness: thin at the 52 px scanner button, a bit thicker on the sheet. */
export function ringWidth(size: number): number { return Math.max(1.5, Math.min(4, size * 0.02)); }
