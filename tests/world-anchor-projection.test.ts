import { describe, expect, it } from "vitest";
import { projectWorldPointToImage, projectWorldRectangle } from "../src/live/worldAnchorProjection";

const frame = (cameraTransform = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]) => ({
  width: 100, height: 100,
  cameraIntrinsics: [100,0,50, 0,100,50, 0,0,1],
  cameraTransform, imageOrientation: 1,
});

describe("world-anchor camera reprojection", () => {
  it("projects a stationary world point back to the same pixels when the camera returns", () => {
    const point = { x: 0, y: 0, z: -2 };
    const first = projectWorldPointToImage(point, frame());
    const movedCamera = frame([1,0,0,0, 0,1,0,0, 0,0,1,0, 0.8,0,0,1]);
    const away = projectWorldPointToImage(point, movedCamera);
    const returned = projectWorldPointToImage(point, frame());
    expect(first).toEqual({ x: 0.5, y: 0.5, depthMetres: 2 });
    expect(away?.x).toBeCloseTo(0.1);
    expect(returned).toEqual(first);
  });

  it("reprojects a retained four-corner bottle rectangle", () => {
    const corners = [
      { x: -0.2, y: 0.4, z: -2 },
      { x: 0.2, y: 0.4, z: -2 },
      { x: 0.2, y: -0.4, z: -2 },
      { x: -0.2, y: -0.4, z: -2 },
    ];
    expect(projectWorldRectangle(corners, frame())).toEqual({
      x: 0.4, y: 0.3, width: 0.2, height: 0.4,
    });
  });

  it("hides anchors behind the camera or outside the current view", () => {
    expect(projectWorldPointToImage({ x: 0, y: 0, z: 2 }, frame())).toBeNull();
    expect(projectWorldRectangle([{x:10,y:0,z:-2},{x:11,y:0,z:-2},{x:11,y:1,z:-2},{x:10,y:1,z:-2}], frame())).toBeNull();
  });
});
