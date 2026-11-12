import { describe, expect, it } from "vitest";
import { shouldEnableLiveRecognition } from "../src/live/recognitionPolicy";

describe("live recognition policy", () => {
  const base = { cameraGranted: true, reviewingCapture: false, scanMode: "auto" as const, activePanel: null };

  it("starts guarded live recognition automatically on the camera viewfinder", () => {
    expect(shouldEnableLiveRecognition(base)).toBe(true);
  });

  it("enables recognition after an explicit bottle scan selection", () => {
    expect(shouldEnableLiveRecognition({ ...base, scanMode: "bottle" })).toBe(true);
  });

  it("enables recognition after an explicit menu scan selection", () => {
    expect(shouldEnableLiveRecognition({ ...base, scanMode: "menu" })).toBe(true);
  });

  it("keeps recognition on for inventory and native LiDAR diagnostics", () => {
    expect(shouldEnableLiveRecognition({ ...base, activePanel: "inventory" })).toBe(true);
    expect(shouldEnableLiveRecognition({ ...base, activePanel: "lidar", platform: "ios" })).toBe(true);
  });

  it("pauses background recognition while unrelated utility panels are open", () => {
    expect(shouldEnableLiveRecognition({ ...base, activePanel: "nearby" })).toBe(false);
    expect(shouldEnableLiveRecognition({ ...base, activePanel: "settings" })).toBe(false);
  });

  it("does not start live reads for the LiDAR panel on the web (LiDAR is native-only)", () => {
    expect(shouldEnableLiveRecognition({ ...base, activePanel: "lidar", platform: "web" })).toBe(false);
    expect(shouldEnableLiveRecognition({ ...base, activePanel: "lidar", platform: "ios" })).toBe(true);
    expect(shouldEnableLiveRecognition({ ...base, activePanel: "lidar", platform: "web", scanMode: "bottle" })).toBe(true);
  });

  it("stops recognition when camera permission is absent or a capture is under review", () => {
    expect(shouldEnableLiveRecognition({ ...base, cameraGranted: false, scanMode: "bottle" })).toBe(false);
    expect(shouldEnableLiveRecognition({ ...base, reviewingCapture: true, scanMode: "bottle" })).toBe(false);
  });
});
