/**
 * Reading labels at a distance (Rob, 15 Nov 2026).
 *
 * The smaller a label is in the camera picture, the more frames are looked at and the sharpest one is
 * sent to be read: a close label is read from one frame at once; a far label waits a few tenths of a
 * second for the sharpest of up to five frames. A label too small to read at all is not sent; its box
 * shows ZOOM IN with how close it is to readable.
 */

/** A label smaller than this (long edge, in real camera pixels) cannot be read. */
export const MIN_READABLE_LABEL_PX = 200;

/** How many frames to look at for a label whose long edge is `longEdgePx` camera pixels. */
export function samplesForLabel(longEdgePx: number): number {
  if (longEdgePx >= 600) return 1;
  if (longEdgePx >= 420) return 2;
  if (longEdgePx >= 300) return 3;
  return 5;
}

/** Time between the frames looked at (ms): about two camera frames apart, so each is a new picture. */
export const SAMPLE_GAP_MS = 70;

/** 0-1: how close a too-small label is to readable (shown as ZOOM IN n%). */
export function zoomReadiness(longEdgePx: number, shortEdgePx: number): number {
  const byLong = longEdgePx / MIN_READABLE_LABEL_PX;
  const byShort = shortEdgePx / (MIN_READABLE_LABEL_PX / 3);
  return Math.max(0, Math.min(0.99, Math.min(byLong, byShort)));
}

/** True when a label crop has enough real pixels to be read. */
export function isReadableLabel(longEdgePx: number, shortEdgePx: number): boolean {
  return longEdgePx >= MIN_READABLE_LABEL_PX && shortEdgePx >= MIN_READABLE_LABEL_PX / 3;
}

/** Zoom steps offered on screen for a camera that reports a zoom range. */
export function zoomSteps(min: number, max: number): number[] {
  const steps = [1, 2, 3, 5].filter((z) => z >= min - 1e-6 && z <= max + 1e-6);
  return steps.length >= 2 ? steps : [];
}
