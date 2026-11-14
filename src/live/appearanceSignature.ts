import type { NormalizedBounds } from './maskContour';

/**
 * A small colour fingerprint of a bottle's label area. Used only to tell
 * bottles apart when re-finding remembered bottles after the camera comes
 * back; never to name a product.
 */
export type AppearanceSignature = Float32Array;

const BINS_PER_CHANNEL = 4;
const BIN_COUNT = BINS_PER_CHANNEL ** 3;

/**
 * 4x4x4 RGB histogram of the bottle's label region (inner 60% width, 30%-85%
 * height), normalized to sum to 1. Returns null for tiny or invalid regions.
 */
export function computeAppearanceSignature(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  bounds: NormalizedBounds,
): AppearanceSignature | null {
  if (rgba.length !== width * height * 4 || width < 2 || height < 2) return null;
  const left = Math.max(0, Math.floor((bounds.x + bounds.width * 0.2) * width));
  const right = Math.min(width, Math.ceil((bounds.x + bounds.width * 0.8) * width));
  const top = Math.max(0, Math.floor((bounds.y + bounds.height * 0.3) * height));
  const bottom = Math.min(height, Math.ceil((bounds.y + bounds.height * 0.85) * height));
  const regionWidth = right - left, regionHeight = bottom - top;
  if (regionWidth < 3 || regionHeight < 3) return null;
  // About 900 samples regardless of box size.
  const step = Math.max(1, Math.round(Math.sqrt((regionWidth * regionHeight) / 900)));
  const histogram = new Float32Array(BIN_COUNT);
  let total = 0;
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      const i = (y * width + x) * 4;
      const r = rgba[i]! >> 6, g = rgba[i + 1]! >> 6, b = rgba[i + 2]! >> 6;
      histogram[(r * BINS_PER_CHANNEL + g) * BINS_PER_CHANNEL + b]! += 1;
      total++;
    }
  }
  if (total < 9) return null;
  for (let i = 0; i < BIN_COUNT; i++) histogram[i] = histogram[i]! / total;
  return histogram;
}

/** Bhattacharyya coefficient: 1 = identical colour mix, 0 = nothing shared. */
export function appearanceSimilarity(a?: AppearanceSignature | null, b?: AppearanceSignature | null): number | null {
  if (!a || !b || a.length !== b.length) return null;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.sqrt(a[i]! * b[i]!);
  return Math.max(0, Math.min(1, sum));
}

/** Blend a new observation into a remembered signature. */
export function blendAppearance(previous: AppearanceSignature | null | undefined, next: AppearanceSignature | null | undefined, weight = 0.3): AppearanceSignature | undefined {
  if (!next) return previous ?? undefined;
  if (!previous || previous.length !== next.length) return next;
  const blended = new Float32Array(next.length);
  for (let i = 0; i < next.length; i++) blended[i] = previous[i]! * (1 - weight) + next[i]! * weight;
  return blended;
}
