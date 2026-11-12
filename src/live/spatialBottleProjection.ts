/**
 * Metric-depth projection primitives for native AR bottle tracking.
 *
 * Coordinates are normalized image-space boxes (0..1). ARKit cameraTransform
 * is supplied as 16 column-major values, matching simd_float4x4 serialization.
 * This module deliberately returns geometry evidence, not a product identity.
 */
export type SpatialDepthFrame = {
  width: number;
  height: number;
  depthMeters: number[];
  confidence: number[];
  cameraIntrinsics: number[];
  cameraTransform: number[];
};

export type NormalizedBox = { x: number; y: number; width: number; height: number };
export type WorldPoint = { x: number; y: number; z: number };
export type DepthProjection =
  | { status: 'located'; worldPoint: WorldPoint; depthMeters: number; validSamples: number; highConfidenceSamples: number }
  | { status: 'potential'; reason: 'invalid_frame' | 'insufficient_depth' | 'low_depth_confidence'; validSamples: number; highConfidenceSamples: number };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function validFrame(frame: SpatialDepthFrame): boolean {
  return Number.isInteger(frame.width) && frame.width > 0 &&
    Number.isInteger(frame.height) && frame.height > 0 &&
    frame.depthMeters.length === frame.width * frame.height &&
    frame.confidence.length === frame.width * frame.height &&
    frame.cameraIntrinsics.length >= 9 &&
    frame.cameraTransform.length === 16 &&
    frame.cameraIntrinsics.every(Number.isFinite) &&
    frame.cameraTransform.every(Number.isFinite);
}

/** Samples a central grid inside a detection, excluding the outer 20% border. */
export function projectBottleBoxToWorld(
  frame: SpatialDepthFrame,
  box: NormalizedBox,
  minimumHighConfidenceSamples = 4,
): DepthProjection {
  if (!validFrame(frame) ||
      ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
      box.width <= 0 || box.height <= 0 ||
      box.x < 0 || box.y < 0 || box.x + box.width > 1 || box.y + box.height > 1) {
    return { status: 'potential', reason: 'invalid_frame', validSamples: 0, highConfidenceSamples: 0 };
  }

  const depths: number[] = [];
  const high: number[] = [];
  const left = Math.floor((box.x + box.width * 0.2) * frame.width);
  const right = Math.max(left + 1, Math.ceil((box.x + box.width * 0.8) * frame.width));
  const top = Math.floor((box.y + box.height * 0.2) * frame.height);
  const bottom = Math.max(top + 1, Math.ceil((box.y + box.height * 0.8) * frame.height));

  for (let y = top; y < Math.min(bottom, frame.height); y += 1) {
    for (let x = left; x < Math.min(right, frame.width); x += 1) {
      const index = y * frame.width + x;
      const depth = frame.depthMeters[index];
      if (Number.isFinite(depth) && depth >= 0.12 && depth <= 8) {
        depths.push(depth);
        if (frame.confidence[index] >= 2) high.push(depth);
      }
    }
  }

  if (depths.length < 4) {
    return { status: 'potential', reason: 'insufficient_depth', validSamples: depths.length, highConfidenceSamples: high.length };
  }
  if (high.length < minimumHighConfidenceSamples) {
    return { status: 'potential', reason: 'low_depth_confidence', validSamples: depths.length, highConfidenceSamples: high.length };
  }

  const depth = median(high);
  const intrinsics = frame.cameraIntrinsics;
  const fx = intrinsics[0], fy = intrinsics[4], cx = intrinsics[2], cy = intrinsics[5];
  if (fx <= 0 || fy <= 0) {
    return { status: 'potential', reason: 'invalid_frame', validSamples: depths.length, highConfidenceSamples: high.length };
  }

  // Use the center of the detection, in the same normalized upright image
  // coordinate system as the emitted depth grid.
  const u = (box.x + box.width / 2) * frame.width;
  const v = (box.y + box.height / 2) * frame.height;
  const cameraX = (u - cx) * depth / fx;
  const cameraY = (v - cy) * depth / fy;
  const cameraZ = -depth;

  // simd_float4x4 serialized column-major: world = M * [cameraX,cameraY,cameraZ,1].
  const m = frame.cameraTransform;
  const worldPoint = {
    x: m[0] * cameraX + m[4] * cameraY + m[8] * cameraZ + m[12],
    y: m[1] * cameraX + m[5] * cameraY + m[9] * cameraZ + m[13],
    z: m[2] * cameraX + m[6] * cameraY + m[10] * cameraZ + m[14],
  };
  if (!Object.values(worldPoint).every(Number.isFinite)) {
    return { status: 'potential', reason: 'invalid_frame', validSamples: depths.length, highConfidenceSamples: high.length };
  }
  return { status: 'located', worldPoint, depthMeters: depth, validSamples: depths.length, highConfidenceSamples: high.length };
}
