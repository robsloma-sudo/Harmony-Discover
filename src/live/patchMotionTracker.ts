export type GrayFrame = { width: number; height: number; pixels: Uint8Array };
export type MotionBox = { x: number; y: number; width: number; height: number };
export type MotionFeature = { x: number; y: number; patch: number[] };
export type MotionTrack = MotionBox & {
  trackId: number;
  confidence: number;
  misses: number;
  features: MotionFeature[];
};

export function grayscaleFrame(width: number, height: number, rgba: Uint8ClampedArray): GrayFrame {
  const pixels = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < pixels.length; i++, p += 4) {
    pixels[i] = Math.round(rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114);
  }
  return { width, height, pixels };
}

function patchAt(frame: GrayFrame, x: number, y: number, radius: number): number[] | null {
  if (x < radius || y < radius || x >= frame.width - radius || y >= frame.height - radius) return null;
  const values: number[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) values.push(frame.pixels[(y + dy) * frame.width + x + dx]);
  }
  return values;
}

function textureScore(patch: number[]): number {
  const mean = patch.reduce((sum, value) => sum + value, 0) / patch.length;
  return patch.reduce((sum, value) => sum + (value - mean) ** 2, 0) / patch.length;
}

function patchErrorAt(frame: GrayFrame, x: number, y: number, radius: number, reference: number[]): number | null {
  if (x < radius || y < radius || x >= frame.width - radius || y >= frame.height - radius) return null;
  let error = 0;
  let index = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    const row = (y + dy) * frame.width;
    for (let dx = -radius; dx <= radius; dx++) {
      error += Math.abs(frame.pixels[row + x + dx] - reference[index++]);
    }
  }
  return error / reference.length;
}


/** Seed high-texture patches inside a confirmed bottle box. Coordinates are in frame pixels. */
export function seedMotionFeatures(frame: GrayFrame, box: MotionBox, maximum = 9): MotionFeature[] {
  const candidates: Array<MotionFeature & { texture: number }> = [];
  const fractions = [0.18, 0.34, 0.5, 0.66, 0.82];
  for (const fy of fractions) {
    for (const fx of fractions) {
      const x = Math.round((box.x + box.width * fx) * frame.width);
      const y = Math.round((box.y + box.height * fy) * frame.height);
      const patch = patchAt(frame, x, y, 2);
      if (!patch) continue;
      const texture = textureScore(patch);
      if (texture >= 90) candidates.push({ x, y, patch, texture });
    }
  }
  candidates.sort((a, b) => b.texture - a.texture);
  const selected: MotionFeature[] = [];
  for (const candidate of candidates) {
    if (selected.every(point => Math.hypot(point.x - candidate.x, point.y - candidate.y) >= 5)) {
      selected.push({ x: candidate.x, y: candidate.y, patch: candidate.patch });
      if (selected.length >= maximum) break;
    }
  }
  return selected;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

/**
 * Propagate a box using sparse patch correspondences. This is a lightweight
 * browser fallback, not a learned detector or a segmentation model.
 */
export function propagateMotionTrack(track: MotionTrack, frame: GrayFrame, searchRadius = 8): MotionTrack {
  if (!track.features.length || frame.width < 16 || frame.height < 16) {
    return { ...track, confidence: track.confidence * 0.65, misses: track.misses + 1 };
  }
  const dxs: number[] = [];
  const dys: number[] = [];
  const nextFeatures: MotionFeature[] = [];
  let totalError = 0;
  for (const feature of track.features) {
    let bestError = Number.POSITIVE_INFINITY;
    let bestX = feature.x;
    let bestY = feature.y;
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        const error = patchErrorAt(frame, feature.x + dx, feature.y + dy, 2, feature.patch);
        if (error === null) continue;
        if (error < bestError) {
          bestError = error;
          bestX = feature.x + dx;
          bestY = feature.y + dy;
        }
      }
    }
    if (bestError <= 18) {
      const nextPatch = patchAt(frame, bestX, bestY, 2);
      if (nextPatch) {
        dxs.push(bestX - feature.x);
        dys.push(bestY - feature.y);
        totalError += bestError;
        nextFeatures.push({ x: bestX, y: bestY, patch: nextPatch });
      }
    }
  }
  const matchRatio = nextFeatures.length / track.features.length;
  if (nextFeatures.length < 3 || matchRatio < 0.34) {
    return { ...track, confidence: track.confidence * 0.82, misses: track.misses + 1 };
  }
  const dx = median(dxs), dy = median(dys);
  const x = Math.max(0, Math.min(1 - track.width, track.x + dx / frame.width));
  const y = Math.max(0, Math.min(1 - track.height, track.y + dy / frame.height));
  const meanError = totalError / nextFeatures.length;
  const confidence = Math.max(0, Math.min(1, matchRatio * (1 - meanError / 36)));
  return { ...track, x, y, confidence, misses: 0, features: nextFeatures };
}
