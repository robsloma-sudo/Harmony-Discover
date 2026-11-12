/**
 * Calibrated camera-space and world-space reconstruction primitives for Discover.
 *
 * Inputs must be metric depth in metres from a calibrated depth provider.
 * Relative monocular depth must NOT be passed here as metres.
 */
export type MetricDepthMap = {
  width: number;
  height: number;
  /** Row-major depth values in metres; invalid samples are 0, NaN, or Infinity. */
  metres: ArrayLike<number>;
  /** Optional ARKit confidence values: 0=low, 1=medium, 2=high. */
  confidence?: ArrayLike<number>;
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
const canonicalZero = (v: number) => Object.is(v, -0) ? 0 : v;

function median(values: number[]): number | null {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** Samples the inner 50% of a box to reduce background-edge contamination. */
export function sampleBoxDepth(depth: MetricDepthMap, box: ImageBox): { metres: number; sampleCount: number } | null {
  if (depth.width < 1 || depth.height < 1 || depth.metres.length < depth.width * depth.height) return null;
  if (depth.confidence && depth.confidence.length < depth.width * depth.height) return null;
  const left = Math.max(0, Math.min(depth.width - 1, Math.floor((box.x0 * 0.75 + box.x1 * 0.25) * depth.width)));
  const right = Math.max(left + 1, Math.min(depth.width, Math.ceil((box.x0 * 0.25 + box.x1 * 0.75) * depth.width)));
  const top = Math.max(0, Math.min(depth.height - 1, Math.floor((box.y0 * 0.75 + box.y1 * 0.25) * depth.height)));
  const bottom = Math.max(top + 1, Math.min(depth.height, Math.ceil((box.y0 * 0.25 + box.y1 * 0.75) * depth.height)));
  const values: number[] = [];
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const index = y * depth.width + x;
      const value = Number(depth.metres[index]);
      const confidence = depth.confidence ? Number(depth.confidence[index]) : 1;
      if (confidence > 0 && finitePositive(value) && value <= 100) values.push(value);
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
    // Normalize signed zero so exact optical-axis alignment is represented consistently.
    x: canonicalZero(((u - intrinsics.cx) / intrinsics.fx) * z),
    y: canonicalZero(-((v - intrinsics.cy) / intrinsics.fy) * z),
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


export type ARKitImageOrientation = 'up' | 'right' | 'down' | 'left';

/** ARKit's 4x4 camera transform is serialized column-major (simd matrix order). */
export function cameraPointToWorld(
  point: CameraSpacePoint,
  cameraTransform: ArrayLike<number>,
  imageOrientation: ARKitImageOrientation,
): { x: number; y: number; z: number } | null {
  if (cameraTransform.length < 16) return null;
  const m = Array.from({ length: 16 }, (_, index) => Number(cameraTransform[index]));
  if (!m.every(Number.isFinite)) return null;

  // Detection unprojection uses the upright scan-image axes (right/up/forward).
  // Rotate those axes back into ARKit's camera-local basis, whose optical axis
  // points along -Z, before applying the world-from-camera transform.
  let cameraX: number;
  let cameraY: number;
  switch (imageOrientation) {
    case 'right':
      cameraX = -point.y;
      cameraY = point.x;
      break;
    case 'left':
      cameraX = point.y;
      cameraY = -point.x;
      break;
    case 'down':
      cameraX = -point.x;
      cameraY = -point.y;
      break;
    default:
      cameraX = point.x;
      cameraY = point.y;
      break;
  }
  const cameraZ = -point.z;
  const world = {
    x: m[0] * cameraX + m[4] * cameraY + m[8] * cameraZ + m[12],
    y: m[1] * cameraX + m[5] * cameraY + m[9] * cameraZ + m[13],
    z: m[2] * cameraX + m[6] * cameraY + m[10] * cameraZ + m[14],
  };
  return Object.values(world).every(Number.isFinite) ? world : null;
}

/** Reads the row-major 3x3 intrinsic matrix emitted in depth-grid pixel units. */
export function intrinsicsFromARKitDepth(frame: { cameraIntrinsics: ArrayLike<number> }): CameraIntrinsics | null {
  const k = frame.cameraIntrinsics;
  if (k.length < 9) return null;
  const fx = Number(k[0]);
  const cx = Number(k[2]);
  const fy = Number(k[4]);
  const cy = Number(k[5]);
  if (![fx, fy, cx, cy].every(Number.isFinite) || !finitePositive(fx) || !finitePositive(fy)) return null;
  return { fx, fy, cx, cy };
}


/** Maps CGImagePropertyOrientation raw values emitted by the native module. */
export function arkitOrientationFromRawValue(value: number): ARKitImageOrientation | null {
  switch (value) {
    case 1: return 'up';
    case 3: return 'down';
    case 6: return 'right';
    case 8: return 'left';
    default: return null;
  }
}


export type WorldPoint = { x: number; y: number; z: number };

export type WorldSpatialDetection = {
  trackId: number;
  point: WorldPoint;
  confidence: number;
};

/**
 * Maintains bottle-centre estimates in ARKit world coordinates across frames.
 * Rejects implausible jumps instead of dragging an established shelf track to
 * a bad depth sample or a mismatched 2D association.
 */
export function updateWorldSpatialTracks(
  previous: SpatialTrack[],
  detections: WorldSpatialDetection[],
  now: number,
  options: { smoothing?: number; maxAgeMs?: number; maxJumpMeters?: number } = {},
): SpatialTrack[] {
  const alpha = Math.max(0.05, Math.min(1, options.smoothing ?? 0.28));
  const maxAgeMs = options.maxAgeMs ?? 7000;
  const maxJumpMeters = options.maxJumpMeters ?? 0.65;
  const old = new Map(previous.map(track => [track.trackId, track]));
  const seen = new Set<number>();
  const next: SpatialTrack[] = [];

  for (const detection of detections) {
    if (seen.has(detection.trackId)) continue;
    seen.add(detection.trackId);
    const target = detection.point;
    if (![target.x, target.y, target.z, detection.confidence].every(Number.isFinite)) continue;
    const prior = old.get(detection.trackId);
    if (!prior) {
      next.push({
        trackId: detection.trackId,
        position: { x: target.x, y: target.y, z: target.z },
        velocity: { x: 0, y: 0, z: 0 },
        confidence: detection.confidence,
        lastSeenAt: now,
      });
      continue;
    }

    const dx = target.x - prior.position.x;
    const dy = target.y - prior.position.y;
    const dz = target.z - prior.position.z;
    const jump = Math.hypot(dx, dy, dz);
    if (jump > maxJumpMeters) {
      // Do not refresh lastSeenAt: repeated rejected measurements must not
      // keep a stale or incorrectly associated object alive indefinitely.
      if (now - prior.lastSeenAt <= maxAgeMs) next.push(prior);
      continue;
    }

    const dt = Math.max(0.001, (now - prior.lastSeenAt) / 1000);
    const position = {
      x: prior.position.x + dx * alpha,
      y: prior.position.y + dy * alpha,
      z: prior.position.z + dz * alpha,
    };
    const velocityAlpha = 0.25;
    const velocity = {
      x: prior.velocity.x * (1 - velocityAlpha) + ((position.x - prior.position.x) / dt) * velocityAlpha,
      y: prior.velocity.y * (1 - velocityAlpha) + ((position.y - prior.position.y) / dt) * velocityAlpha,
      z: prior.velocity.z * (1 - velocityAlpha) + ((position.z - prior.position.z) / dt) * velocityAlpha,
    };
    next.push({ trackId: detection.trackId, position, velocity, confidence: detection.confidence, lastSeenAt: now });
  }

  for (const track of previous) {
    if (!seen.has(track.trackId) && now - track.lastSeenAt <= maxAgeMs) next.push(track);
  }
  return next;
}
