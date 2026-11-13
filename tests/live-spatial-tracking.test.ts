import { describe, expect, it } from "vitest";
import {
  arkitOrientationFromRawValue,
  cameraPointToWorld,
  intrinsicsFromARKitDepth,
  sampleBoxDepth,
  unprojectDetection,
  updateWorldSpatialTracks,
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
    expect(sampleBoxDepth(depth, { x0: 0, y0: 0, x1: 1, y1: 1 })).toEqual({ metres: 2, sampleCount: 3, highConfidenceSampleCount: 3 });
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


describe("persistent world-space bottle tracks", () => {
  it("applies camera translation and rotation using the column-major ARKit matrix", () => {
    const rotatedAndTranslated = [
      0, 0, 1, 0,
      0, 1, 0, 0,
      -1, 0, 0, 0,
      10, 20, 30, 1,
    ];
    const point: CameraSpacePoint = { x: 1, y: 2, z: 3, depthMetres: 3, sampleCount: 4 };
    expect(cameraPointToWorld(point, rotatedAndTranslated, "up")).toEqual({ x: 13, y: 22, z: 31 });
  });

  it("smooths a persistent world position and estimates low-pass velocity", () => {
    const first = updateWorldSpatialTracks([], [{ trackId: 7, point: { x: 1, y: 2, z: 3 }, confidence: 0.9 }], 1000);
    const next = updateWorldSpatialTracks(first, [{ trackId: 7, point: { x: 1.2, y: 2, z: 3 }, confidence: 0.95 }], 2000);
    expect(next).toHaveLength(1);
    expect(next[0].position.x).toBeCloseTo(1.056);
    expect(next[0].velocity.x).toBeGreaterThan(0);
    expect(next[0].lastSeenAt).toBe(2000);
  });

  it("rejects large world-space jumps without refreshing a stale track", () => {
    const first = updateWorldSpatialTracks([], [{ trackId: 4, point: { x: 0, y: 0, z: 0 }, confidence: 0.8 }], 1000);
    const rejected = updateWorldSpatialTracks(first, [{ trackId: 4, point: { x: 3, y: 0, z: 0 }, confidence: 0.99 }], 2000);
    expect(rejected[0].position).toEqual({ x: 0, y: 0, z: 0 });
    expect(rejected[0].lastSeenAt).toBe(1000);
    expect(updateWorldSpatialTracks(rejected, [], 9000)).toHaveLength(0);
  });

  it("expires unseen tracks and ignores duplicate track IDs in one frame", () => {
    const tracks = updateWorldSpatialTracks([], [
      { trackId: 2, point: { x: 0, y: 0, z: 1 }, confidence: 0.8 },
      { trackId: 2, point: { x: 9, y: 9, z: 9 }, confidence: 1 },
    ], 1000);
    expect(tracks).toHaveLength(1);
    // Duplicate source IDs are resolved by confidence; the strongest observation wins.
    expect(tracks[0].position).toEqual({ x: 9, y: 9, z: 9 });
    expect(updateWorldSpatialTracks(tracks, [], 9000)).toHaveLength(0);
  });
});


describe("world-track identity reassociation", () => {
  it("preserves a stable world ID when the transient 2D detector ID changes", () => {
    const first = updateWorldSpatialTracks([], [{
      trackId: 21,
      point: { x: 1, y: 0, z: 2 },
      confidence: 0.9,
      categoryKey: "whiskey",
      identityKey: "maker a label x",
      box: { x0: 0.2, y0: 0.1, x1: 0.4, y1: 0.8 },
    }], 1000);
    const second = updateWorldSpatialTracks(first, [{
      trackId: 88,
      point: { x: 1.04, y: 0, z: 2.02 },
      confidence: 0.95,
      categoryKey: "whiskey",
      identityKey: "maker a label x",
      box: { x0: 0.21, y0: 0.1, x1: 0.41, y1: 0.8 },
    }], 2000);
    expect(second).toHaveLength(1);
    expect(second[0].trackId).toBe(first[0].trackId);
    expect(second[0].sourceTrackId).toBe(88);
    expect(second[0].lastSeenAt).toBe(2000);
  });

  it("uses category as a hard gate but allows uncertain label evidence to vary", () => {
    const first = updateWorldSpatialTracks([], [{
      trackId: 3, point: { x: 0, y: 0, z: 1 }, confidence: 0.9,
      categoryKey: "whiskey", identityKey: "label one",
    }], 1000);
    const sameCategory = updateWorldSpatialTracks(first, [{
      trackId: 4, point: { x: 0.02, y: 0, z: 1 }, confidence: 0.8,
      categoryKey: "whiskey", identityKey: "label uncertain",
    }], 2000);
    expect(sameCategory).toHaveLength(1);
    expect(sameCategory[0].trackId).toBe(first[0].trackId);

    const differentCategory = updateWorldSpatialTracks(sameCategory, [{
      trackId: 5, point: { x: 0.03, y: 0, z: 1 }, confidence: 0.99,
      categoryKey: "wine", identityKey: "label one",
    }], 3000);
    expect(differentCategory).toHaveLength(2);
    expect(new Set(differentCategory.map(track => track.trackId)).size).toBe(2);
  });

  it("prevents stable-ID collisions when conflicting identity evidence splits a detection", () => {
    const first = updateWorldSpatialTracks([], [{
      trackId: 6, point: { x: 0, y: 0, z: 1 }, confidence: 0.9,
      categoryKey: "whiskey", identityKey: "label a",
    }], 1000);
    const split = updateWorldSpatialTracks(first, [{
      trackId: 6, point: { x: 0.02, y: 0, z: 1 }, confidence: 0.9,
      categoryKey: "wine", identityKey: "label b",
    }], 2000);
    expect(split).toHaveLength(2);
    expect(new Set(split.map(track => track.trackId)).size).toBe(2);
    expect(split.find(track => track.sourceTrackId === 6)?.categoryKey).toBe("wine");
  });

  it("keeps nearby but distinct bottle instances separate outside the tight reassociation gate", () => {
    const first = updateWorldSpatialTracks([], [{
      trackId: 10, point: { x: 0, y: 0, z: 1 }, confidence: 0.9, categoryKey: "whiskey",
    }], 1000);
    const second = updateWorldSpatialTracks(first, [{
      trackId: 11, point: { x: 0.3, y: 0, z: 1 }, confidence: 0.9, categoryKey: "whiskey",
    }], 2000);
    expect(second).toHaveLength(2);
    expect(new Set(second.map(track => track.trackId)).size).toBe(2);
  });

  it("does not merge separate bottles beyond the reassociation radius", () => {
    const first = updateWorldSpatialTracks([], [{
      trackId: 1, point: { x: 0, y: 0, z: 1 }, confidence: 0.9, categoryKey: "whiskey",
    }], 1000);
    const second = updateWorldSpatialTracks(first, [{
      trackId: 2, point: { x: 0.8, y: 0, z: 1 }, confidence: 0.9, categoryKey: "whiskey",
    }], 2000);
    expect(second).toHaveLength(2);
  });
});
