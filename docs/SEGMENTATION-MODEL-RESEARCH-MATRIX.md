# Harmony Discover — Segmentation Model Research Matrix

Status: internal research only. No model in this document is approved for public distribution.
Branch: `fix/spatial-frame-sync-2026-11-12`

## Operating decision

During prototype development, evaluate useful models regardless of whether their weights are Apache/MIT, research-only, non-commercial, or otherwise restricted. The restriction is on how the resulting model/code/weights may be used or distributed, not on running a lawful internal experiment.

For every candidate, preserve the exact source URL, revision, weight hash, model card, dataset provenance, license text, export settings, runtime, benchmark results, and any notices/attribution. Do not silently mix restricted weights into a distributable app bundle. Before public launch, either replace restricted assets with commercially cleared assets, train a replacement on appropriately licensed data, or obtain permission.

## Candidate ladder

| Candidate | Role in experiment | Initial priority | License / release treatment |
|---|---|---:|---|
| D-FINE-seg-N, COCO instance segmentation | Small one-pass bottle-category detector + instance masks | P0 | Upstream documents code and COCO instance weights as Apache-2.0. Verify exact artifact and dependencies. |
| D-FINE-seg-S, COCO instance segmentation | Accuracy/latency comparison to N | P1 | Same COCO weight family; verify exact artifact and dependencies. |
| D-FINE-seg-M/L | Quality ceiling and offline comparison | P2 | Same COCO weight family; may be too heavy for browser/mobile. |
| D-FINE Cityscapes semantic weights | Research comparison only; dense foreground/class masks | P2 | Dataset-derived non-commercial terms. Internal research only; do not ship or use commercially without permission/replacement. |
| MobileSAM | Box-prompted refinement for each detected bottle | P1 | Track upstream code and original SAM-derived weight terms separately; some mirrors/re-exports have inconsistent license labels. |
| SAM 2.1 Tiny | Prompted refinement and mask propagation comparison | P1 | Verify exact upstream checkpoint, ONNX conversion, and model-card terms. Do not rely on third-party catalog labels alone. |
| Apple Vision foreground-instance masks | Native iOS comparison | P1 | Platform API; generic foreground masks, not a bottle detector. Physical-device benchmark required. |
| Custom bottle segmentation model | Long-term release candidate | P3 | Train/fine-tune on curated, rights-cleared bottle imagery and annotations; audit all training data and dependencies. |

## Benchmark protocol

Run each candidate against the same versioned image/frame set and track seeds. Record:
- mask IoU and boundary F-score against hand-annotated masks;
- correct bottle-to-mask association rate and ambiguous-match rejection rate;
- false masks on people, shelves, glassware, labels, reflections, and background;
- clear glass, dark glass, glare, backlighting, occlusion, adjacent bottles, unusual shapes, and motion blur;
- cold model-load time, first-mask latency, warm latency, sustained masks/second, peak memory, and failure rate;
- desktop Chrome and iOS Safari WASM separately; native iOS separately;
- model bytes, runtime bytes, cache behavior, and battery/thermal impact.

Never compare a high-resolution model run against a lower-resolution candidate without recording the input-size difference. Report accuracy and latency together. Do not promote a candidate based on demo footage or synthetic masks.

## Architecture rules

1. Bottle detection seeds the box and persistent visual track ID.
2. A segmentation provider returns source-frame-timestamped instance masks.
3. Masks are matched to bottle seeds using overlap and confidence; one mask can map to one track only.
4. Ambiguous, stale, low-quality, malformed, or unassociated masks are rejected.
5. Accepted masks become normalized contours and are attached to the persistent visual track.
6. Prior measured contours may be propagated briefly between fresh masks; confidence decays and contours expire with the track.
7. No mask means no bottle silhouette. Never substitute a rectangle or generic motion region as a bottle outline.
8. Segmentation runs at a bounded cadence, not at the 10 Hz tracking cadence. Keep one in-flight inference per camera session and discard stale results after lifecycle resets.

## D-FINE-seg ONNX integration contract

The upstream ONNX wrapper documents the graph outputs as:
- labels: [B, K]
- boxes: [B, K, 4], absolute xyxy coordinates in network-input pixel space
- scores: [B, K]
- instance masks: [B, K, Hm, Wm] for the segment task

The upstream Python wrapper then applies confidence filtering, label filtering, NMS, box rescaling, mask resize to original-image dimensions, thresholding, and mask cleanup. The raw browser adapter must not mistake the raw ONNX mask grid for a full-resolution mask.

Discover now has `adaptDfineSegOnnxOutput`, which consumes the raw output tensors, filters the configured COCO bottle class, rescales boxes into normalized camera coordinates, applies NMS, crops low-resolution masks to their corresponding boxes, bilinearly upsamples only each box crop to original-frame resolution, thresholds it, and returns per-instance crops to the shared association layer. It intentionally avoids expanding every proposal mask to full camera resolution.

Preprocessing assumption in this first adapter: direct resize to the model's fixed input dimensions, with independent x/y normalization back to the original frame. Letterbox preprocessing is not supported by this adapter yet and must not be enabled until the inverse pad/scale transform is implemented and fixture-tested.

The provider includes a direct-resize RGB NCHW float32 preprocessing path and injected WASM-first ONNX session factory. The model artifact still needs to be generated; the app package/lockfile integration and live-camera initialization are not yet connected.

## Current implementation state

- `maskContour.ts`: mask-to-contour extraction and validation.
- `MaskContourOverlay.tsx`: rendering of supplied contours.
- `trackedBottleRegistry.ts`: persistent visual track metadata and bounded contour carry-forward.
- `segmentationEngine.ts`: provider-neutral interface, one-to-one mask/track association, timestamp/confidence/geometry rejection, single-flight bounded-cadence runner, lifecycle reset/disposal.
- `tests/segmentation-engine.test.ts`: synthetic fixture tests for association, ambiguity, malformed/stale masks, cadence, and disposal.
- No actual model weights are bundled and no ONNX Runtime Web dependency is yet in the app package/lockfile. A manual GitHub Actions workflow now builds D-FINE-seg COCO ONNX artifacts (N/S/M/L/X), records upstream commit and SHA-256, and uploads the model as a short-lived workflow artifact. The provider is testable with an injected runtime but is not currently instantiated by the live camera. Synthetic fixture tests validate preprocessing, output adaptation, association, and lifecycle contracts only.

## Next implementation sequence

1. Run typecheck and focused tests; repair any contract or test failures.
2. Add a reproducible model acquisition/export workspace that is not bundled into the app by default.
3. Export D-FINE-seg-N COCO instance model to ONNX and record artifact hash + model metadata.
4. Implement and fixture-test the exact D-FINE ONNX output decoder.
5. Add ONNX Runtime Web WASM inference behind the provider interface.
6. Wire accepted contours into the live track registry with camera-session generation guards.
7. Add MobileSAM and SAM 2.1 Tiny prompted-refinement adapters as separate providers.
8. Benchmark all candidates on the same dataset, then choose the best working prototype stack.
9. Before public release, run a complete license/data audit and replace restricted assets as needed.

## Primary references

- D-FINE-seg: https://github.com/ArgoHA/D-FINE-seg
- D-FINE-seg model card: https://huggingface.co/ArgoSA/D-FINE-seg
- ONNX Runtime Web: https://onnxruntime.ai/docs/tutorials/web/
- MobileSAM: https://github.com/ChaoningZhang/MobileSAM
- MobileSAM browser example: https://github.com/akbartus/MobileSAM-in-the-Browser
- SAM 2: https://github.com/facebookresearch/sam2
- Apple Vision foreground-instance mask request: https://developer.apple.com/documentation/vision/vngenerateforegroundinstancemaskrequest
