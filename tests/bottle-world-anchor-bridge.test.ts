import { describe, expect, it } from "vitest";
import { buildBottleWorldObservations } from "../src/live/bottleWorldAnchorBridge";

const frame = (overrides: Record<string, unknown> = {}) => ({
  width: 4, height: 4, depthMeters: Array(16).fill(2), confidence: Array(16).fill(2),
  cameraIntrinsics: [2, 0, 2, 0, 2, 2, 0, 0, 1],
  cameraTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  timestamp: 10, unit: "meters" as const, imageOrientation: 1, ...overrides,
});
const candidate = (overrides: Record<string, unknown> = {}) => ({
  trackId: 7, x: 0.25, y: 0.25, width: 0.5, height: 0.5,
  confidence: 0.9, timestamp: 10,
  contour: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],
  bottle: { brand: "Maker", product: "Reserve" }, ...overrides,
});

describe("ARKit bottle world-anchor bridge", () => {
  it("unprojects a synchronized bottle detection into metric world coordinates", () => {
    const result = buildBottleWorldObservations([candidate()], frame());
    expect(result.rejected).toEqual([]);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].worldPoint).toEqual({ x: 0, y: 0, z: -2 });
    expect(result.observations[0].depthMetres).toBe(2);
    expect(result.observations[0].geometryComplete).toBe(true);
    expect(result.observations[0].visualKey).toBe("maker reserve");
  });

  it("rejects depth from a different camera moment", () => {
    const result = buildBottleWorldObservations([candidate({ timestamp: 10.5 })], frame());
    expect(result.observations).toHaveLength(0);
    expect(result.rejected[0].reason).toBe("depth_frame_timestamp_mismatch");
  });

  it("rejects weak detections and malformed boxes instead of inventing anchors", () => {
    const result = buildBottleWorldObservations([
      candidate({ confidence: 0.3 }),
      candidate({ trackId: 8, x: -0.2 }),
    ], frame());
    expect(result.observations).toHaveLength(0);
    expect(result.rejected.map(item => item.reason)).toEqual(["low_detection_confidence", "invalid_detection_box"]);
  });

  it("rejects invalid metric depth and camera calibration", () => {
    const badDepth = buildBottleWorldObservations([candidate()], frame({ depthMeters: Array(16).fill(0) }));
    expect(badDepth.rejected[0].reason).toBe("insufficient_metric_depth");
    const badCalibration = buildBottleWorldObservations([candidate()], frame({ cameraIntrinsics: [0,0,0,0,0,0,0,0,1] }));
    expect(badCalibration.rejected[0].reason).toBe("invalid_camera_intrinsics");
  });

  it("does not treat relative depth as metric", () => {
    const result = buildBottleWorldObservations([candidate()], frame({ unit: "relative" }));
    expect(result.rejected[0].reason).toBe("non_metric_depth");
  });
});
