# Continuous Bottle Tracking — Phase 2 Implementation Plan

Status: engineering plan based on source audit of `fix/spatial-frame-sync-2026-11-12`.
Scope: isolated Harmony Discover feature branch only. No production deployment, Supabase mutation, Edge Function deployment, or merge is authorized by this plan.

## 1. Verified current architecture

The home viewfinder mounts `DiscoverARSurface` from `app/index.tsx`. On iOS, the native ARKit view emits camera frames for cloud reads and depth frames. The home view pairs cloud bottle boxes with a depth frame within 200 ms, projects each bottle box to a world point, and updates `SpatialBottleTracker` once per cloud-read timestamp.

Current rates and limitations:
- Native Vision OCR, barcode detection, and generic classification are scheduled at 2 Hz.
- Cloud bottle recognition is paced at approximately 2.5 seconds.
- Spatial physical-ID association currently updates only when a new cloud bottle result arrives.
- The Swift `associateCandidates` and `drawCandidates` methods have no call sites. The native `onVisualCandidates` event is currently only emitted as an empty list during lifecycle transitions.
- Web temporal IOU matching smooths cloud detections but does not estimate motion between recognition calls.
- ARKit point anchors are 2.5 cm spheres at projected world points; they are not bottle meshes, segmentation masks, or contours.

Therefore, the current code does **not** provide continuous local bottle tracking. The 3D projection is a world-point estimate from a cloud box and a timestamp-matched depth sample, not a reconstructed bottle surface.

## 2. Required tracking data contract

Every seed must carry:
- `seedId`: monotonically unique within the current camera generation.
- `physicalObjectId`: stable identity assigned by the spatial tracker, not a product SKU.
- `box`: normalized top-left-origin rectangle in the exact source image coordinate space.
- `sourceTimestamp`: ARKit monotonic frame timestamp (seconds) or browser media timestamp, never wall-clock time.
- `imageWidth`, `imageHeight`, `orientation`.
- `seedConfidence`, `identityKey` (category + brand + expression), and optional barcode evidence.
- `generation`: invalidates all async work after stop, restart, background, interruption, or camera replacement.

Tracker output must include:
- `physicalObjectId`, updated normalized box, confidence, source timestamp, state (`tracked`, `occluded`, `reacquiring`, `lost`), and explicit reason.
- No output may claim bottle identity solely from generic image classification.
- Product identity (brand/expression/vintage/SKU) and physical-instance identity must remain separate.

## 3. iOS implementation

Use Vision `VNTrackObjectRequest` seeded only from accepted cloud bottle boxes:
1. Add a native `trackingRegions` prop to `DiscoverARView`. The home view passes newly accepted bottle boxes with the exact cloud source timestamp, image dimensions, orientation, identity key, and camera generation.
2. Reject seeds whose timestamp does not match the source frame or whose normalized box is invalid/out of bounds.
3. Create one `VNDetectedObjectObservation` and `VNTrackObjectRequest` per physical object. Use a serial Vision queue and a bounded frame gate; never enqueue an unbounded backlog.
4. Run `VNSequenceRequestHandler` against subsequent ARKit pixel buffers. Preserve each request's identity. Process at a measured target cadence (initial target 10–15 Hz, then profile on supported iPhones) rather than assuming 60 Hz is affordable.
5. Apply confidence thresholds and temporal decay. A low-confidence result becomes occluded/reacquiring; it must not silently snap to another nearby bottle.
6. Reacquire only with strong geometric and appearance/identity agreement. If ambiguous, keep separate IDs or mark lost rather than merge.
7. On generation change, interruption, reset, or session teardown: cancel/clear all requests and frame references.
8. Emit tracked boxes and their source frame timestamps. The JS overlay must render only results that can be mapped to the displayed camera frame without a stale-frame jump.

Vision tracking provides 2D boxes, not bottle contours or metric bottle surfaces. Keep that distinction explicit.

## 4. Web implementation

The browser path needs a separate, capability-gated tracker:
1. Seed from cloud bottle boxes and preserve the source video-frame timestamp and dimensions.
2. Propagate between cloud calls with a local motion tracker (initial candidate: Lucas–Kanade optical flow using OpenCV.js, subject to bundle-size and browser-memory profiling).
3. Use periodic local detector refreshes to recover drift/occlusion; optical flow alone is not a detector and must not invent a bottle when features disappear.
4. Use one-to-one association, motion gating, confidence decay, and camera-generation invalidation.
5. Stop work while hidden; release frame buffers, workers, and canvases on teardown.
6. If the browser/device cannot sustain the tracker, degrade honestly to the existing intermittent recognition overlay.

Do not add a large model or WASM bundle until a measured prototype demonstrates acceptable iPhone Safari startup, memory, and sustained frame rate.

## 5. Multi-object and identity safeguards

Required before enabling by default:
- Two adjacent bottles with similar labels remain separate.
- Two identical SKUs remain separate physical instances.
- A bottle moved across the frame retains its physical ID.
- Partial/full occlusion does not cause immediate ID reuse.
- A new bottle entering beside an existing bottle does not inherit its ID.
- A barcode/product match may strengthen product identity but cannot alone merge physical tracks.
- Track expiration and reacquisition are explicit, tested state transitions.
- World-point projection must use depth from the same source frame (existing 200 ms gate is a maximum tolerance; exact timestamp pairing is preferred).

## 6. Validation matrix

Unit tests:
- seed validation and timestamp/orientation mismatch;
- one-to-one multi-object association;
- confidence decay and occlusion grace;
- ID preservation during translation and scale change;
- ID separation for adjacent/identical bottles;
- lost/reacquired behavior;
- generation invalidation and stale async callback rejection;
- bounded queue behavior and teardown cleanup.

Recorded-frame integration tests:
- camera translation, rotation, distance change;
- one and multiple bottles;
- partial and full occlusion;
- reflections, low light, motion blur;
- wine bottles with dark glass and foil; clear spirits; beer cans; short/wide packages;
- similar label designs and multiple vintages/SKUs.

Device gates:
- iPhone Safari memory and sustained performance for web;
- LiDAR-capable iPhone for ARKit, coordinate orientation and depth pairing;
- no claims of physical 3D reconstruction until a mesh/shape pipeline is independently validated.

## 7. Licensing and dependency gate

Before adding a model, WASM package, or native SDK:
- verify the exact repository, code license, model-weight license, redistribution terms, and commercial-use rights;
- prefer MIT, Apache-2.0, or BSD for new dependencies;
- do not introduce GPL/AGPL or paid SDK dependencies;
- EdgeSAM commercial permission and MobileSAM weight licensing remain unresolved gates. Do not ship either until verified.

## 8. Delivery sequence

A. Implement native Vision tracking seed contract and state machine behind a disabled-by-default feature flag.
B. Add recorded-frame tests and verify iOS simulator compilation.
C. Add browser optical-flow prototype behind capability detection; profile bundle and memory.
D. Run multi-bottle and physical-device tests.
E. Only after evidence, enable tracking and proceed to bottle-instance segmentation/contour rendering.

No phase should be marked complete from compilation alone. No rectangular box or point anchor should be presented as a bottle contour or reconstructed bottle mesh.
