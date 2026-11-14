# Shelf-scan regression annotations

Source: user-provided 19.23-second recording, 512x1112, 30 fps.

The TypeScript fixture contains approximate manual bounds for selected visible physical objects at 5s, 9s, and 18s. Coordinates are normalized against the complete screen recording, not a cropped camera-only viewport.

## Annotation limits
- Bounds are approximate visual annotations, not pixel-perfect ground truth.
- Product identity is intentionally not asserted. Visible scanner captions are not trusted as ground truth.
- Object continuity is assigned only where the same physical object is visually recognizable across the sampled frames.
- The 18s frame contains additional visible objects whose identity/continuity is not asserted.

## Test scope
The accompanying Vitest tests validate annotation integrity and replay the 5s/9s approximate geometry through the existing LocalBottleTracker, asserting per-object track continuity. Additional synthetic scenarios cover adjacent identical-looking bottles, camera pan, temporary occlusion, and stale track-ID reuse. These are deterministic geometry-policy tests, not a full video/model replay: the app does not expose raw detector outputs for this screen recording, and the recording itself contains rendered overlays rather than raw camera frames.

Next stage: replace approximate bounds with reviewed pixel-level annotations and add a captured detector-output replay adapter before using these tests to claim tracking accuracy.
