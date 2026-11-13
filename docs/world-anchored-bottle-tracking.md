# World-anchored bottle tracking

## Current implementation

The native iOS camera path now attaches a compact metric ARKit scene-depth sample, camera intrinsics, camera transform, orientation, and ARFrame timestamp to the exact image frame sent for bottle recognition. The recognition result retains that timestamp. The bridge rejects any candidate whose timestamp differs from its depth frame by more than 120 ms, and rejects relative depth, invalid calibration, malformed boxes, weak detections, and unusable depth.

Accepted detections are unprojected into ARKit world coordinates. The four corners of the detected image rectangle are stored in world coordinates and reprojected using the latest camera pose. A world-space tracker retains the physical instance across temporary missed observations and tracking relocalization.

## Geometry limitation

The current four-corner shape is a world-anchored rectangular plane at the robust median depth sampled inside the bottle box. It is not a reconstructed bottle surface or volumetric cuboid. The plane is stable in world space and should return to the same projected location when the camera returns, but it does not yet model the bottle's front/back curvature, depth extent, or full contour in 3D. Do not label it a complete 3D bottle mesh.

## Device requirements

- Metric depth is used only when ARKit supplies sceneDepth or smoothedSceneDepth on a supported device.
- Browser relative-depth estimates are never passed into the metric world-anchor bridge.
- Devices without ARKit scene depth can still use the ordinary screen-space detection path; they do not receive metric world anchors from this implementation.
- Anchors are session-local. This work does not persist an ARWorldMap across app launches or guarantee recovery after a fresh AR session.

## Physical-device acceptance test

1. Use a supported LiDAR iPhone, good indoor lighting, and a stationary bottle with visible label and bottle edges.
2. Start the live scanner and wait for a confident bottle read and a visible WORLD ANCHOR overlay.
3. Keep the bottle stationary. Rotate the phone approximately 180 degrees away until the bottle leaves the camera frustum.
4. Hold briefly, then rotate back to the original camera position and orientation.
5. Confirm the same bottle overlay returns at the same physical location, without creating a duplicate identity or jumping to a neighboring bottle.
6. Repeat with two bottles close together, a short hand occlusion, and a brief ARKit limited/relocalizing state.
7. Repeat in a new session to confirm the expected limitation: session-local anchors are not promised to survive a full session reset.

Suggested QA targets (to be confirmed on hardware, not yet measured): less than 5 cm world-position drift for a stationary bottle over the turn-away/turn-back cycle; projected rectangle returns within 3% of the original image width/height. Record device model, iOS version, LiDAR capability, lighting, depth confidence, tracking state, and observed drift.

## Release gate

Do not describe this as production-validated until the physical-device acceptance test passes. Automated geometry/projection tests verify math and rejection behavior only; they do not prove camera calibration, ARKit relocalization quality, bottle segmentation accuracy, or on-device performance.
