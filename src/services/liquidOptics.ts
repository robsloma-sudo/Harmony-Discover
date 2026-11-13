import type { PixelBounds, PixelFrame } from './liquidLevelDetector';

export type LiquidOpticalAssessment = {
  status: 'observable' | 'limited' | 'unobservable';
  score: number;
  sampledPixels: number;
  clippedHighlightFraction: number;
  deepShadowFraction: number;
  luminanceRange: number;
  reason: string;
};

/**
 * Estimates whether a bottle crop contains enough usable optical information
 * for a liquid-boundary detector. This is a quality gate, not a liquid detector.
 * It deliberately abstains on severe glare, near-black crops, and flat crops.
 */
export function assessLiquidOpticalVisibility(
  frame: PixelFrame,
  bounds: PixelBounds,
): LiquidOpticalAssessment {
  if (!frame || !frame.data || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) ||
      frame.width < 8 || frame.height < 12 || frame.data.length < frame.width * frame.height * 4 ||
      !bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
      bounds.width < 8 || bounds.height < 12) {
    return { status: 'unobservable', score: 0, sampledPixels: 0, clippedHighlightFraction: 0, deepShadowFraction: 0, luminanceRange: 0, reason: 'invalid_crop' };
  }
  const left = Math.max(0, Math.floor(bounds.x));
  const right = Math.min(frame.width, Math.ceil(bounds.x + bounds.width));
  const top = Math.max(0, Math.floor(bounds.y));
  const bottom = Math.min(frame.height, Math.ceil(bounds.y + bounds.height));
  if (right - left < 8 || bottom - top < 12) {
    return { status: 'unobservable', score: 0, sampledPixels: 0, clippedHighlightFraction: 0, deepShadowFraction: 0, luminanceRange: 0, reason: 'crop_outside_frame' };
  }

  // A small deterministic grid bounds the cost even for high-resolution frames.
  const columns = 13;
  const rows = 25;
  let count = 0;
  let clipped = 0;
  let dark = 0;
  let minLuma = 255;
  let maxLuma = 0;
  let sum = 0;
  let sumSquares = 0;
  for (let row = 0; row < rows; row += 1) {
    const y = Math.min(bottom - 1, top + Math.floor(((row + 0.5) / rows) * (bottom - top)));
    for (let column = 0; column < columns; column += 1) {
      const x = Math.min(right - 1, left + Math.floor(((column + 0.5) / columns) * (right - left)));
      const offset = (y * frame.width + x) * 4;
      if ((frame.data[offset + 3] ?? 255) < 32) continue;
      const r = frame.data[offset], g = frame.data[offset + 1], b = frame.data[offset + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count += 1;
      if (Math.min(r, g, b) >= 248) clipped += 1;
      if (luma <= 12) dark += 1;
      minLuma = Math.min(minLuma, luma);
      maxLuma = Math.max(maxLuma, luma);
      sum += luma;
      sumSquares += luma * luma;
    }
  }
  if (count < 40) {
    return { status: 'unobservable', score: 0, sampledPixels: count, clippedHighlightFraction: 0, deepShadowFraction: 0, luminanceRange: 0, reason: 'insufficient_valid_pixels' };
  }
  const clippedHighlightFraction = clipped / count;
  const deepShadowFraction = dark / count;
  const luminanceRange = maxLuma - minLuma;
  const mean = sum / count;
  const variance = Math.max(0, sumSquares / count - mean * mean);
  const standardDeviation = Math.sqrt(variance);
  if (clippedHighlightFraction >= 0.42) {
    return { status: 'unobservable', score: 0.1, sampledPixels: count, clippedHighlightFraction, deepShadowFraction, luminanceRange, reason: 'severe_specular_glare' };
  }
  if (deepShadowFraction >= 0.82 || mean <= 9) {
    return { status: 'unobservable', score: 0.1, sampledPixels: count, clippedHighlightFraction, deepShadowFraction, luminanceRange, reason: 'underexposed_or_opaque_crop' };
  }
  if (luminanceRange < 5 || standardDeviation < 2.5) {
    return { status: 'limited', score: 0.35, sampledPixels: count, clippedHighlightFraction, deepShadowFraction, luminanceRange, reason: 'insufficient_local_optical_variation' };
  }
  const glarePenalty = Math.max(0, 1 - clippedHighlightFraction * 1.8);
  const shadowPenalty = Math.max(0, 1 - deepShadowFraction * 0.8);
  const rangeScore = Math.min(1, luminanceRange / 55);
  const score = Math.max(0, Math.min(1, glarePenalty * shadowPenalty * (0.55 + rangeScore * 0.45)));
  return { status: score >= 0.55 ? 'observable' : 'limited', score, sampledPixels: count, clippedHighlightFraction, deepShadowFraction, luminanceRange, reason: score >= 0.55 ? 'usable_optical_signal' : 'mixed_glare_shadow_or_low_contrast' };
}
