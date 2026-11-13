import { arkitOrientationFromRawValue, type WorldPoint } from "./spatialTracking";

export type CameraProjectionFrame = {
  width: number;
  height: number;
  cameraIntrinsics: number[];
  cameraTransform: number[];
  imageOrientation: number;
};

export type NormalizedRect = { x: number; y: number; width: number; height: number };

export function projectWorldPointToImage(
  point: WorldPoint,
  frame: CameraProjectionFrame,
): { x: number; y: number; depthMetres: number } | null {
  if (frame.width <= 0 || frame.height <= 0 || frame.cameraTransform.length < 16 || frame.cameraIntrinsics.length < 9) return null;
  const m = frame.cameraTransform;
  if (!m.every(Number.isFinite) || !frame.cameraIntrinsics.every(Number.isFinite)) return null;
  const orientation = arkitOrientationFromRawValue(frame.imageOrientation);
  if (!orientation) return null;

  // ARKit cameraTransform is column-major world-from-camera. Invert its rigid
  // transform by transposing the rotation and subtracting camera translation.
  const dx = point.x - m[12], dy = point.y - m[13], dz = point.z - m[14];
  const cameraX = m[0] * dx + m[1] * dy + m[2] * dz;
  const cameraY = m[4] * dx + m[5] * dy + m[6] * dz;
  const cameraZ = m[8] * dx + m[9] * dy + m[10] * dz;
  const z = -cameraZ;
  if (!Number.isFinite(z) || z <= 0.05) return null;

  let imageX: number, imageY: number;
  switch (orientation) {
    case "right": imageX = cameraY; imageY = -cameraX; break;
    case "left": imageX = -cameraY; imageY = cameraX; break;
    case "down": imageX = -cameraX; imageY = -cameraY; break;
    default: imageX = cameraX; imageY = cameraY; break;
  }
  const fx = frame.cameraIntrinsics[0], cx = frame.cameraIntrinsics[2];
  const fy = frame.cameraIntrinsics[4], cy = frame.cameraIntrinsics[5];
  if (fx <= 0 || fy <= 0) return null;
  const u = (fx * imageX / z + cx) / frame.width;
  const v = (cy - fy * imageY / z) / frame.height;
  return Number.isFinite(u) && Number.isFinite(v) ? { x: u, y: v, depthMetres: z } : null;
}

export function projectWorldRectangle(
  corners: WorldPoint[],
  frame: CameraProjectionFrame,
): NormalizedRect | null {
  if (corners.length !== 4) return null;
  const points = corners.map(point => projectWorldPointToImage(point, frame));
  if (points.some(point => !point)) return null;
  const valid = points as Array<{ x: number; y: number; depthMetres: number }>;
  const left = Math.min(...valid.map(point => point.x));
  const right = Math.max(...valid.map(point => point.x));
  const top = Math.min(...valid.map(point => point.y));
  const bottom = Math.max(...valid.map(point => point.y));
  if (right <= 0 || bottom <= 0 || left >= 1 || top >= 1) return null;
  const x = Math.max(0, left), y = Math.max(0, top);
  const x2 = Math.min(1, right), y2 = Math.min(1, bottom);
  if (x2 - x < 0.008 || y2 - y < 0.008) return null;
  return { x, y, width: x2 - x, height: y2 - y };
}
