/**
 * Camera-space 3D reconstruction primitives for the Discover web scanner.
 *
 * Inputs must be metric depth in metres from a calibrated depth provider.
 * Relative monocular depth must NOT be passed here as metres.
 */
export type MetricDepthMap = {
  width: number;
  height: number;
  /** Row-major depth values in metres; invalid samples are 0, NaN, or Infinity. */
  metres: ArrayLike<number>;
};

export type CameraIntrinsics = {
  /** Horizontal and vertical focal lengths in pixels. */
  fx: number;
  fy: number;
  /** Principal point in source-frame pixels. */
  cx: number;
  cy: number;
};

export type ImageBox = { x0: number; y0: number; x1: number; y1: number };

export type CameraSpacePoint = {
  x: number;
  y: number;
  z: number;
  /** Robust median depth of the central portion of the detection, metres. */
  depthMetres: number;
  sampleCount: number;
};

export type SpatialDetection = {
  trackId: number;
  box: ImageBox;
  confidence: number;
};

export type SpatialTrack = {
  trackId: number;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  confidence: number;
  lastSeenAt: number;
};

const finitePositive = (v: number) => Number.isFinite(v) && v > 0;

function median(values: number[]): number | null {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** Samples the inner 50% of a box to reduce background-edge contamination. */
export function sampleBoxDepth(depth: MetricDepthMap, box: ImageBox): { metres: number; sampleCount: number } | null {
  if (depth.width < 1 || depth.height < 1 || depth.metres.length < depth.width * depth.height) return null;
  const left = Math.max(0, Math.min(depth.width - 1, Math.floor((box.x0 * 0.25 + box.x1 * 0.75) * depth.width)));
  const right = Math.max(left + 1, Math.min(depth.width, Math.ceil((box.x0 * 0.75 + box.x1 * 0.25) * depth.width)));
  const top = Math.max(0, Math.min(depth.height - 1, Math.floor((box.y0 * 0.25 + box.y1 * 0.75) * depth.height)));
  const bottom = Math.max(top + 1, Math.min(depth.height, Math.ceil((box.y0 * 0.75 + box.y1 * 0.25) * depth.height)));
  const values: number[] = [];
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const value = Number(depth.metres[y * depth.width + x]);
      if (finitePositive(value) && value <= 100) values.push(value);
    }
  }
  const value = median(values);
  return value === null ? null : { metres: value, sampleCount: values.length };
}

/** Unprojects the detection centre into camera coordinates (x right, y up, z forward). */
export function unprojectDetection(box: ImageBox, depth: MetricDepthMap, intrinsics: CameraIntrinsics): CameraSpacePoint | null {
  if (![intrinsics.fx, intrinsics.fy].every(finitePositive) || ![intrinsics.cx, intrinsics.cy].every(Number.isFinite)) return null;
  const sampled = sampleBoxDepth(depth, box);
  if (!sampled) return null;
  const u = ((box.x0 + box.x1) / 2) * depth.width;
  const v = ((box.y0 + box.y1) / 2) * depth.height;
  const z = sampled.metres;
  return {
    x: ((u - intrinsics.cx) / intrinsics.fx) * z,
    y: -((v - intrinsics.cy) / intrinsics.fy) * z,
    z,
    depthMetres: z,
    sampleCount: sampled.sampleCount,
  };
}

/**
 * Updates camera-space tracks. Coordinates are relative to the current camera
 * frame; callers must apply visual-odometry camera pose to obtain world space.
 */
export function updateSpatialTracks(
  previous: SpatialTrack[],
  detections: Array<{ trackId: number; point: CameraSpacePoint; confidence: number }>,
  now: number,
  smoothing = 0.35,
  maxAgeMs = 1200,
): SpatialTrack[] {
  const old = new Map(previous.map(track => [track.trackId, track]));
  const seen = new Set<number>();
  const next: SpatialTrack[] = [];
  for (const detection of detections) {
    if (seen.has(detection.trackId)) continue;
    seen.add(detection.trackId);
    const prior = old.get(detection.trackId);
    const target = { x: detection.point.x, y: detection.point.y, z: detection.point.z };
    if (!prior) {
      next.push({ trackId: detection.trackId, position: target, velocity: { x: 0, y: 0, z: 0 }, confidence: detection.confidence, lastSeenAt: now });
      continue;
    }
    const dt = Math.max(0.001, (now - prior.lastSeenAt) / 1000);
    const alpha = Math.max(0.05, Math.min(1, smoothing));
    const position = {
      x: prior.position.x + (target.x - prior.position.x) * alpha,
      y: prior.position.y + (target.y - prior.position.y) * alpha,
      z: prior.position.z + (target.z - prior.position.z) * alpha,
    };
    next.push({
      trackId: detection.trackId,
      position,
      velocity: { x: (position.x - prior.position.x) / dt, y: (position.y - prior.position.y) / dt, z: (position.z - prior.position.z) / dt },
      confidence: detection.confidence,
      lastSeenAt: now,
    });
  }
  for (const track of previous) {
    if (!seen.has(track.trackId) && now - track.lastSeenAt <= maxAgeMs) next.push(track);
  }
  return next;
}
