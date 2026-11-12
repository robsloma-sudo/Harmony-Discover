# Harmony Discover Phase 4 — Segmentation Engine Implementation Plan

Status: **in progress — model inference is not yet integrated or validated**  
Branch: `fix/spatial-frame-sync-2026-11-12`  
Scope: Harmony Discover only. No Supabase migrations, Edge Function deployment, production merge, or Netlify deployment.

## Phase objective

Produce real per-bottle instance masks and normalized contours for the live scanner. A rectangle, propagated rectangle, or generic motion region must never be presented as a bottle silhouette.

## Findings from source audit

The current branch already contains:
- `extractMaskContour` to turn a binary/probability mask into a normalized external contour.
- `MaskContourOverlay` to render supplied contours.
- Persistent visual track IDs and a contour-warping fallback between fresh observations.
- A strict visual rule: the overlay renders no silhouette when no actual mask exists.

The missing component is the model inference provider. No segmentation runtime or model weights are currently in `package.json` or the repository. The existing contour tests validate synthetic masks; they do not prove that a camera frame can generate a bottle mask.

## Candidate decision

### Browser-first candidate: D-FINE-seg-N instance segmentation

Use the upstream COCO **instance-segmentation** checkpoint, not the Cityscapes semantic-segmentation checkpoint.

Reasons:
- Upstream repository is Apache-2.0 and documents Apache-2.0 COCO instance-segmentation weights.
- COCO includes a generic bottle category, giving a one-pass instance-mask starting point.
- Upstream supports ONNX export.
- N is the smaller first browser candidate; S is the quality comparison.

License gate:
- Do not use the Cityscapes semantic-segmentation weights; upstream says those weights inherit non-commercial Cityscapes terms.
- Before bundling any ONNX artifact, record the exact upstream checkpoint/export source, SHA-256, model card, dataset terms, and license notices in the repository.
- A generic COCO bottle class is not a claim of reliable wine/spirits/beer packaging segmentation. A bottle-specific dataset and evaluation are still required.

### Browser runtime

Use ONNX Runtime Web with WebAssembly as the required baseline. Official compatibility currently lists WASM on iOS Safari and does not list WebGPU on iOS Safari. WebGL is maintenance-mode and must not be the only path.

WebGPU may be an optional acceleration path on supported desktop browsers, with WASM fallback. Do not infer iPhone Safari performance from desktop WebGPU.

### Native iPhone comparison

Evaluate Apple's Vision foreground-instance mask request on a physical iOS 17+ device. It is a generic foreground-instance separator, not a bottle detector. It must be associated to cloud-seeded bottle tracks using mask/box overlap; instance ordering must never be treated as bottle identity.

### Secondary refinement candidate

Keep MobileSAM as a later box-prompted mask-refinement comparison. Do not make it the first required path until its encoder/decoder latency and browser compatibility are measured on target iPhones.

## Required runtime architecture

1. Existing trusted cloud bottle detections seed per-bottle boxes and persistent visual track IDs.
2. A segmentation scheduler requests masks only for new or materially changed tracks, with a bounded cadence and one in-flight inference per camera session.
3. The provider returns per-instance masks with source frame timestamp, track association, mask dimensions, model/runtime identifier, and confidence/quality metadata.
4. Associate masks to bottle seeds using overlap/IoU and reject ambiguous or low-overlap matches.
5. Convert accepted masks using `extractMaskContour`; validate area, bounds, point count, and mask-to-seed overlap.
6. Attach the contour to the persistent visual track ID.
7. Propagate a prior measured contour between fresh masks only while the visual track remains valid; decay confidence and expire it after bounded misses.
8. If inference is unavailable, too slow, ambiguous, or low quality, retain the conservative detection box and show no silhouette.

Product identity confidence, bottle detection confidence, mask confidence, and physical 3D tracking confidence remain separate values.

## Performance policy

- Do not run segmentation at the 10 Hz tracking cadence.
- Initial experiment: one mask refresh per second at most, only when a trusted bottle seed exists; adapt cadence based on measured latency and drift.
- Bound input dimensions, concurrent inference, queued frames, mask resolution, and contour point count.
- Cancel stale results when camera session/generation changes or the source frame is too old.
- Release model sessions and temporary frame/mask buffers when the scanner stops.
- Keep inference on-device for the browser experiment; do not upload camera frames to a third-party model service.

## Phase acceptance gates

### Correctness
- Real camera frame -> real model output -> per-instance mask -> contour overlay.
- Mask must correspond to the correct persistent bottle track, not merely any foreground object.
- Adjacent bottles, overlapping bottles, partial occlusion, shelf clutter, clear glass, dark glass, glare, backlighting, motion blur, and unusual bottle shapes.
- No fabricated silhouettes when the model fails.
- Hand-annotated held-out set with mask IoU and boundary F-score. Thresholds must be defined before tuning and results reported separately by scenario.

### Browser/device
- Desktop Chrome and iOS Safari tested separately.
- iOS Safari WASM path is mandatory; WebGPU is not available there according to current ONNX Runtime compatibility documentation.
- Record cold/warm first-mask latency, sustained refresh rate, memory, battery, and 10-minute thermal behavior.
- Native Core ML/Vision comparison must be measured on a physical supported iPhone, not inferred from simulator compilation.

### Release
- Typecheck, focused unit tests, full regression, web export, and native build.
- Model artifact provenance and license audit complete.
- No production deployment until all acceptance gates pass.

## Current phase status

<badge color="warning">Implementation in progress — not accepted</badge>

### Verified model artifact
- D-FINE-seg-N COCO instance-segmentation model exported to ONNX FP32 and passed upstream parity.
- Model is versioned under `public/models/` with license, provenance, graph contract, and SHA-256 metadata.
- SHA-256: `999b6ae8970461b9a2b4a50f6cf07df3f355b131698a3e5b56cd420fbea5de30`.
- Real exported graph contract was inspected and executed with ONNX Runtime CPU:
  - Input `input`: FP32 `[1, 3, 640, 640]`
  - `labels`: INT64 `[1, 300]`
  - `boxes`: FP32 `[1, 300, 4]`
  - `scores`: FP32 `[1, 300]`
  - `masks`: FP32 `[1, 300, 160, 160]`
- Browser runtime dependency is pinned in the lockfile; web build copies only the required WASM binary and JS glue assets into `public/ort/`.
- Browser loader verifies the model checksum before creating a WASM-only inference session.

### Live camera integration now implemented in a separate draft branch
- Bounded local inference is started from the same cropped camera frame sent to cloud recognition.
- Inference cadence is bounded to at least 2.2 seconds, max 8 tracks, and 1.6-second frame freshness.
- Only cloud-detected bottle boxes seed mask association.
- Masks are associated by overlap and source timestamp to persistent bottle track IDs.
- Accepted mask contours are emitted to the existing overlay path; prior contours are transformed with track motion between fresh masks.
- No box-derived or fabricated silhouettes are emitted when inference fails.
- The web runtime is platform-specific; native builds use a stub rather than bundling the browser ONNX Runtime package.

### Build validation
- D-FINE export, graph inspection, ONNX CPU smoke test, and model provenance packaging have succeeded.
- A native iOS simulator build has succeeded on the platform-separated runtime branch. This is a compile check only, not a physical-device test.
- The latest web camera integration CI is still pending. An earlier web export caught Metro resolving the native/server stub instead of the web runtime; platform-specific `.web.ts` loader and an exported-bundle check have been added to catch this.

### Still not complete
- No actual bottle camera frame has yet been shown to produce and render a D-FINE mask in a running browser.
- No hand-annotated bottle segmentation dataset or mask IoU / boundary F-score benchmark exists yet.
- No physical iPhone Safari performance, battery, memory, or thermal test has been run.
- COCO's generic bottle category is not beverage SKU/product recognition; product identity remains the separate Phase 5 pipeline.
- License and redistribution review must be completed before public model distribution.

## Immediate implementation sequence

1. Finish the current web bundle verification, including the model URL and required WASM assets in the exported client bundle.
2. Run a real bottle image/frame through the WASM provider and inspect decoded masks, crop alignment, confidence, and contour overlay.
3. Test multiple adjacent bottles, partial occlusion, glare, dark/clear glass, shelf clutter, and motion blur; record false masks and missed masks.
4. Measure cold/warm first-mask latency and sustained inference cadence on desktop Chrome and iOS Safari.
5. Obtain physical iPhone measurements for memory, battery, and 10-minute thermal behavior.
6. Build a hand-annotated held-out dataset and report mask IoU and boundary F-score by scenario before setting release thresholds.
7. Complete model license review and full regression before considering any production release.

## References

- D-FINE-seg upstream: https://github.com/ArgoHA/D-FINE-seg
- ONNX Runtime Web browser support: https://onnxruntime.ai/docs/get-started/with-javascript/web.html
- ONNX Runtime Web overview: https://onnxruntime.ai/docs/tutorials/web/
- ONNX Runtime Web deployment assets: https://onnxruntime.ai/docs/tutorials/web/deploy.html
- Apple Vision foreground instance masks: https://developer.apple.com/documentation/vision/vngenerateforegroundinstancemaskrequest
- MobileSAM upstream: https://github.com/ChaoningZhang/MobileSAM
