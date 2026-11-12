# Harmony Discover Phase 4 — Segmentation Engine Implementation Plan

Status: **in progress — model and browser/WASM inference are integrated and CI-validated; physical-device and real-bottle acceptance remain open**  
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

The D-FINE-seg-N ONNX model, pinned ONNX Runtime Web WASM runtime, browser camera integration, model-integrity verification, and mask-to-track overlay path are now implemented. CI executes the real model with ONNX Runtime CPU and ONNX Runtime Web WASM and validates output tensors. The browser camera captures the same centered, cover-cropped frame shown to the user, runs bounded single-flight inference in parallel with cloud recognition, associates masks to persistent track IDs, and emits contours only from measured mask pixels. The CI runtime smoke test uses a zero-valued tensor; positive bottle detection and real-camera output are not yet proven.

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
- The committed COCO instance-segmentation artifact records its upstream checkpoint/export source, SHA-256, model card, and Apache-2.0 license notice in repository metadata. The upstream model card states code and COCO-pretrained instance-segmentation checkpoints are Apache-2.0; internal legal/data-provenance review is still required before public redistribution.
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
2. The browser camera scheduler captures the current visible/cropped frame at the existing cloud-recognition cadence, with a one-second minimum segmentation interval and one in-flight inference per camera session. The model currently processes the full cropped frame; it is not yet a per-track ROI model.
3. The provider returns per-instance masks with source frame timestamp, mask dimensions, model/runtime identifier, detection confidence, and mask quality. Track association is performed against the same-frame cloud-seeded persistent bottle tracks.
4. Associate masks to bottle seeds using overlap/IoU and reject ambiguous or low-overlap matches.
5. Convert accepted masks using `extractMaskContour`; validate area, bounds, point count, and mask-to-seed overlap.
6. Attach the contour to the persistent visual track ID.
7. Propagate a prior measured contour between fresh masks only while the visual track remains valid; decay confidence and expire it after bounded misses.
8. If inference is unavailable, too slow, ambiguous, or low quality, retain the conservative detection box and show no silhouette.

Product identity confidence, bottle detection confidence, mask confidence, and physical 3D tracking confidence remain separate values.

## Performance policy

- Do not run segmentation at the 10 Hz tracking cadence.
- Initial experiment: at most one segmentation inference per second, started alongside a trusted cloud bottle read; current cloud recognition cadence is slower than this cap. Adapt cadence based on measured latency and drift.
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

**Not complete.** The D-FINE-seg-N COCO ONNX model is committed under `public/models/` with checksum, provenance, Apache-2.0 license metadata, and an actual graph contract generated by inspecting and executing the model. The pinned runtime is `onnxruntime-web@1.31.1`; the web prebuild copies the UMD browser bundle, WASM loader modules, and WASM binaries into `public/ort/` so Expo Metro does not parse the runtime's internal dynamic imports.

The browser camera path now loads the UMD runtime outside Metro, downloads the model with a 45-second timeout and 32 MB size cap, verifies SHA-256 before session creation, and backs off failed initialization attempts. It performs bounded WASM inference alongside cloud bottle recognition, associates real mask outputs to same-frame persistent visual track IDs, and maps contours to the actual camera cover crop. Prior measured contours may be warped with their tracked boxes for a bounded period; no silhouette is fabricated when inference fails.

CI currently verifies:
- ONNX checksum, ONNX checker, actual graph input/output names/shapes, and CPU inference.
- Actual ONNX Runtime Web WASM inference using the committed model and tensor contract.
- TypeScript, Deno live-reader check, scanner/segmentation/contour tests, Expo web export, and local UMD/WASM runtime assets.
- The overlay's centered cover-crop transform with unit tests.

**Remaining gaps:** the runtime smoke tests use a zero-valued 640x640 tensor, not a positive bottle image. There is no held-out annotated beverage-bottle dataset, no measured bottle-mask IoU/boundary F-score, and no verified first-mask result from a real browser camera session or physical iPhone. Sustained latency, memory, battery, and thermal behavior remain unmeasured. The model is a generic COCO bottle class, not a wine/spirits/beer SKU segmenter.

## Immediate implementation sequence

1. Run a positive bottle-image inference test using a rights-cleared, annotated bottle image; verify class 39 detection, box coordinates, mask probabilities, and contour extraction.
2. Build a versioned, manually annotated bottle evaluation set covering clear/dark glass, glare, backlighting, overlap, shelf clutter, reflections, motion blur, and unusual bottle shapes. Report mask IoU, boundary F-score, detection recall/precision, and bottle-to-mask association rate.
3. Test the web export in desktop Chrome and iPhone Safari with real camera permissions. Verify model download/checksum, UMD/WASM initialization, first mask, contour alignment, and graceful fallback.
4. Measure cold load, first-mask latency, warm latency, sustained cadence, memory, long-session stability, battery, and thermal behavior on a physical iPhone.
5. Tune cadence, score threshold, mask threshold, crop resolution, and contour point budget only against the fixed evaluation set.
6. Preserve the Apache-2.0 notice and metadata; complete internal legal/data-provenance review before public redistribution.
7. Evaluate D-FINE-seg-S/M, MobileSAM, or native Vision only if the N baseline's measured accuracy or performance requires a comparison. Native iOS segmentation remains a separate later phase.

## References

- D-FINE-seg upstream: https://github.com/ArgoHA/D-FINE-seg
- ONNX Runtime Web browser support: https://onnxruntime.ai/docs/get-started/with-javascript/web.html
- ONNX Runtime Web overview: https://onnxruntime.ai/docs/tutorials/web/
- Apple Vision foreground instance masks: https://developer.apple.com/documentation/vision/vngenerateforegroundinstancemaskrequest
- MobileSAM upstream: https://github.com/ChaoningZhang/MobileSAM
