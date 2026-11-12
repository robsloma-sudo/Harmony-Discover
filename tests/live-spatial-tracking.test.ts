import { describe, expect, it } from "vitest";
import {
  arkitOrientationFromRawValue,
  cameraPointToWorld,
  intrinsicsFromARKitDepth,
  sampleBoxDepth,
  unprojectDetection,
  type CameraSpacePoint,
} from "../src/live/spatialTracking";

const identityColumnMajor = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

describe("ARKit depth calibration", () => {
  it("reads the scaled row-major intrinsics emitted with the compact depth grid", () => {
    expect(intrinsicsFromARKitDepth({ cameraIntrinsics: [100, 0, 32, 0, 110, 24, 0, 0, 1] }))
      .toEqual({ fx: 100, fy: 110, cx: 32, cy: 24 });
    expect(intrinsicsFromARKitDepth({ cameraIntrinsics: [0, 0, 0, 0, 0, 0, 0, 0, 1] })).toBeNull();
  });

  it("rejects invalid depth samples and uses a median from the inner box", () => {
    const depth = { width: 4, height: 4, metres: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 2, 2, 2, 2, 2] };
    expect(sampleBoxDepth(depth, { x0: 0, y0: 0, x1: 1, y1: 1 })).toEqual({ metres: 2, sampleCount: 15 });
  });

  it("unprojects normalized detections using depth-grid pixel intrinsics", () => {
    const depth = { width: 4, height: 4, metres: Array(16).fill(2) };
    const point = unprojectDetection(
      { x0: 0.5, y0: 0.25, x1: 1, y1: 0.75 },
      depth,
      { fx: 2, fy: 2, cx: 2, cy: 2 },
    );
    expect(point?.x).toBe(1);
    expect(point?.y).toBe(0);
    expect(point?.z).toBe(2);
  });

  it("converts upright image coordinates into ARKit camera coordinates before world projection", () => {
    const point: CameraSpacePoint = { x: 1, y: 2, z: 3, depthMetres: 3, sampleCount: 4 };
    expect(cameraPointToWorld(point, identityColumnMajor, "right")).toEqual({ x: -2, y: 1, z: -3 });
    expect(cameraPointToWorld(point, identityColumnMajor, "left")).toEqual({ x: 2, y: -1, z: -3 });
    expect(cameraPointToWorld(point, identityColumnMajor, "up")).toEqual({ x: 1, y: 2, z: -3 });
  });

  it("decodes only the four orientations the native pipeline currently emits", () => {
    expect(arkitOrientationFromRawValue(6)).toBe("right");
    expect(arkitOrientationFromRawValue(8)).toBe("left");
    expect(arkitOrientationFromRawValue(3)).toBe("down");
    expect(arkitOrientationFromRawValue(1)).toBe("up");
    expect(arkitOrientationFromRawValue(7)).toBeNull();
  });

  it("rejects malformed camera transforms", () => {
    expect(cameraPointToWorld({ x: 0, y: 0, z: 1, depthMetres: 1, sampleCount: 1 }, [1, 2], "up")).toBeNull();
  });
});
