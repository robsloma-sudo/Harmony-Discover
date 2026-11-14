# Shelf-scan regression annotations

Source: user-provided 19.23-second recording, 512x1112, 30 fps.

The TypeScript fixture contains approximate manual bounds for selected visible physical objects at 5s, 9s, and 18s. Coordinates are normalized against the complete screen recording, not a cropped camera-only viewport.

## Annotation limits
- Bounds are approximate visual annotations, not pixel-perfect ground truth.
- Product identity is intentionally not asserted. Visible scanner captions are not trusted as ground truth.
- Object continuity is assigned only where the same physical object is visually recognizable across the sampled frames.
- The 18s frame contains additional visible objects whose identity/continuity is not asserted.
- The full-screen recording includes app chrome and a camera viewport. These coordinates have not been transformed into the camera frame's normalized coordinate space and must not be passed directly to the camera-space tracker.

## Test scope
The shelf fixture tests annotation integrity, normalized bounds, coordinate-space declaration, and continuity labels across selected frames. It does not replay the bounds through LocalBottleTracker because the required screen-to-camera transform is not established. Separate synthetic tests exercise LocalBottleTracker behavior for adjacent identical-looking bottles, camera pan, temporary occlusion, and stale track-ID reuse.

Next stage: produce pixel-reviewed annotations in camera-frame coordinates (or document and test the exact screen-to-camera transform), then add captured detector-output replay before using the fixture to claim tracking accuracy.
