import {
  arkitOrientationFromRawValue,
  cameraPointToWorld,
  intrinsicsFromARKitDepth,
  unprojectDetection,
  type ImageBox,
  type MetricDepthMap,
  type WorldPoint,
} from "./spatialTracking";

export type ARKitMetricDepthFrame = {
  width: number;
  height: number;
  depthMeters: number[];
  confidence: number[];
  cameraIntrinsics: number[];
  cameraTransform: number[];
  timestamp: number;
  unit: "meters";
  imageOrientation: number;
};

export type BottleSpatialCandidate = {
  trackId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  timestamp: number;
  contour?: Array<{ x: number; y: number }>;
  bottle?: { brand?: string; product?: string; category?: string };
};

export type BottleWorldObservation = {
  trackId: number;
  worldPoint: WorldPoint;
  confidence: number;
  geometryComplete: boolean;
  visualKey?: string;
  box: ImageBox;
  depthMetres: number;
  sampleCount: number;
};

export type SpatialBridgeResult = {
  observations: BottleWorldObservation[];
  rejected: Array<{ trackId: number; reason: string }>;
};

/**
 * Converts detections into metric ARKit world observations.
 * The caller must supply a depth frame captured close to the candidate frame;
 * relative browser depth is intentionally not accepted by this API.
 */
export function buildBottleWorldObservations(
  candidates: BottleSpatialCandidate[],
  frame: ARKitMetricDepthFrame,
  options: { maxTimestampDeltaSeconds?: number; minimumConfidence?: number } = {},
): SpatialBridgeResult {
  const observations: BottleWorldObservation[] = [];
  const rejected: Array<{ trackId: number; reason: string }> = [];
  const orientation = arkitOrientationFromRawValue(frame.imageOrientation);
  const intrinsics = intrinsicsFromARKitDepth({ cameraIntrinsics: frame.cameraIntrinsics });
  const depth: MetricDepthMap = {
    width: frame.width,
    height: frame.height,
    metres: frame.depthMeters,
    confidence: frame.confidence,
  };

  for (const candidate of candidates) {
    const reject = (reason: string) => rejected.push({ trackId: candidate.trackId, reason });
    if (frame.unit !== "meters") { reject("non_metric_depth"); continue; }
    if (!orientation) { reject("unsupported_image_orientation"); continue; }
    if (!intrinsics) { reject("invalid_camera_intrinsics"); continue; }
    if (!Number.isFinite(candidate.timestamp) || !Number.isFinite(frame.timestamp)
      || Math.abs(candidate.timestamp - frame.timestamp) > (options.maxTimestampDeltaSeconds ?? 0.12)) {
      reject("depth_frame_timestamp_mismatch");
      continue;
    }
    if (!Number.isFinite(candidate.confidence)
      || candidate.confidence < (options.minimumConfidence ?? 0.65)) {
      reject("low_detection_confidence");
      continue;
    }
    const box: ImageBox = {
      x0: candidate.x,
      y0: candidate.y,
      x1: candidate.x + candidate.width,
      y1: candidate.y + candidate.height,
    };
    if (![box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)
      || box.x0 < 0 || box.y0 < 0 || box.x1 > 1 || box.y1 > 1
      || box.x1 <= box.x0 || box.y1 <= box.y0) {
      reject("invalid_detection_box");
      continue;
    }
    const cameraPoint = unprojectDetection(box, depth, intrinsics);
    if (!cameraPoint) { reject("insufficient_metric_depth"); continue; }
    const worldPoint = cameraPointToWorld(cameraPoint, frame.cameraTransform, orientation);
    if (!worldPoint) { reject("invalid_camera_transform"); continue; }
    const identity = [candidate.bottle?.brand, candidate.bottle?.product]
      .filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const worldCorners = [
      [box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1],
    ].flatMap(([x, y]) => {
      const u = x * depth.width, v = y * depth.height, z = cameraPoint.depthMetres;
      const corner = {
        x: ((u - intrinsics.cx) / intrinsics.fx) * z,
        y: -((v - intrinsics.cy) / intrinsics.fy) * z,
        z, depthMetres: z, sampleCount: cameraPoint.sampleCount,
      };
      const worldCorner = cameraPointToWorld(corner, frame.cameraTransform, orientation);
      return worldCorner ? [worldCorner] : [];
    });
    if (worldCorners.length !== 4) { reject("invalid_camera_transform"); continue; }
    observations.push({
      trackId: candidate.trackId,
      worldPoint,
      worldCorners,
      confidence: candidate.confidence,
      geometryComplete: !!candidate.contour && candidate.contour.length >= 4,
      ...(identity ? { visualKey: identity } : {}),
      box,
      depthMetres: cameraPoint.depthMetres,
      sampleCount: cameraPoint.sampleCount,
    });
  }
  return { observations, rejected };
}
