# Discover scanner: local segmentation candidate evaluation

Status: research gate only. No segmentation model or model weights are bundled or enabled by this document.

## Non-negotiable constraints

- Commercial use must be permitted by the exact code and checkpoint licenses.
- Prefer MIT, Apache-2.0, or BSD-3-Clause.
- Exclude GPL/AGPL dependencies and checkpoints.
- Do not draw a bottle silhouette from a detection rectangle. A visible contour must come from an actual instance mask.
- Cloud bottle reads remain the initial product-identification source until a local model is trained and independently validated.
- Do not deploy a model into production before browser and target-iPhone latency, memory, battery, thermal, and mask-quality gates pass.

## Candidates

### D-FINE-seg-N / S — leading instance-mask experiment

Repository: https://github.com/ArgoHA/D-FINE-seg

- Repository code is Apache-2.0.
- The repository states that its COCO detection and instance-segmentation weights are Apache-2.0; Cityscapes semantic-segmentation checkpoints are non-commercial and must not be used.
- COCO instance-segmentation weights include the COCO bottle class. This is a useful generic bottle prior, not a guarantee that the model will segment every spirit, wine, beer, can, keg, or unusual package correctly.
- The N COCO instance-segmentation checkpoint is listed at 5.1M parameters; the S checkpoint is 11.9M. Both are designed around 640x640 inference.
- A third-party ONNX model catalog lists exported COCO segmentation graphs at approximately 17.89 MB (N) and 47.62 MB (S). Treat these as candidate artifacts; verify exact provenance, checksum, and license notices before bundling.
- The project exports ONNX and Core ML; its inference wrappers return per-instance masks.
- Published speed numbers are from an RTX 5070 Ti / TensorRT benchmark, not an iPhone or browser. Do not reuse those numbers as mobile performance claims.

Why it is promising: unlike prompt-only segmentation, it can produce instance masks for bottle-class objects in one model pass. Start with N for the browser download/memory budget, then compare S for mask quality. It is also a plausible source for a later Harmony-trained bottle-specific segmentation model.

Risks: COCO bottle coverage is generic; clear glass, dark glass, foil necks, overlapping shelf stock, label glare, and unusual shapes may reduce mask quality. Browser ONNX operator compatibility and iPhone Core ML latency are unmeasured.

### MobileSAM — box-prompted mask-refinement experiment

Repository: https://github.com/ChaoningZhang/MobileSAM

- The upstream repository is Apache-2.0.
- It is promptable: the current cloud bottle box can seed a mask for that object.
- This fits the existing cloud-seed -> local-propagation architecture.
- A public browser demo exists: https://github.com/akbartus/MobileSAM-in-the-Browser

Risks: the browser demo explicitly reports using ONNX Runtime Web 1.14.0 because newer versions had compatibility/segmentation-quality problems in that implementation. Treat that as a warning, not a current compatibility guarantee. The model's 1024-pixel encoder input and separate decoder pipeline may be expensive for a live iPhone browser session. Benchmark before selecting it.

### Excluded candidates

- EdgeSAM: the upstream repository's S-Lab License 1.0 permits non-commercial use; commercial use requires contacting contributors for permission. It does not meet the current commercial-use gate without a written commercial grant.
- Ultralytics YOLO iOS app / YOLO family: the cited iOS repository is AGPL-3.0. Excluded under the no-AGPL rule.
- FastSAM implementations derived from YOLOv8/Ultralytics AGPL code: excluded unless an independently licensed implementation and weights are verified.

## Runtime constraints

ONNX Runtime Web documentation currently lists WebAssembly support on iOS Safari, while WebGPU is not supported there. WebGL is listed for iOS Safari but is in maintenance mode and supports only a subset of operators. Therefore:
- iOS Safari must have a tested WASM path; WebGPU cannot be assumed.
- WebGL is an optional experimental acceleration path, not the only supported path.
- The browser benchmark must include iOS Safari, not only desktop Chrome.
- The iOS native path should evaluate Core ML separately; do not assume browser and Core ML performance are interchangeable.

## Proposed architecture

1. Cloud recognition returns bottle boxes and product/label metadata.
2. A local instance-segmentation model produces a per-bottle mask for new or materially changed tracks.
3. Convert the mask to a normalized contour polygon and associate it with the persistent visual track ID.
4. Propagate the mask/contour between segmentation refreshes using local frame tracking.
5. Re-run segmentation only when confidence, mask overlap, or boundary drift crosses a threshold.
6. If mask quality fails, show the conservative detection box and explicitly avoid drawing a fabricated silhouette.

This separates product recognition, physical-object tracking, and contour segmentation. They must not share one confidence score.

## Benchmark gate before integration

Use the same curated, held-out camera set for every candidate:
- Clear, green, amber, dark, frosted, and opaque bottles.
- Wine bottles with shoulder/neck variations, foil, wax, and capsule.
- Beer bottles, cans, growlers, and kegs.
- Overlapping products, backlit shelves, glare, low light, motion blur, and partial occlusion.
- Multiple vintages/SKUs with visually similar packaging.

Record:
- Instance mask IoU and boundary F-score against hand-checked masks.
- Bottle-class precision/recall and false-positive rate.
- First-mask latency (cold and warm), sustained mask refresh rate, and tracking frame rate.
- Peak memory, model download size, battery draw, and thermal throttling over a 10-minute scan.
- Results separately for desktop Chrome, iOS Safari, and native iOS Core ML.

Initial engineering targets (not achieved results): first useful mask under 500 ms after a trusted seed; local propagation at 10 Hz or better; no overlay identity swap in the defined test sequences; no unbounded memory growth over a 10-minute session. Mask-quality thresholds must be set from the annotated dataset before tuning the model.

## Decision

Prototype D-FINE-seg-N, D-FINE-seg-S, and MobileSAM side by side. D-FINE-seg-N is the first browser candidate by size; S is the quality comparison. D-FINE-seg is the leading candidate for generic bottle instance masks and future fine-tuning; MobileSAM is the prompt-refinement comparison for cloud-seeded boxes. Do not adopt either until exact checkpoint provenance, browser operator support, and iPhone measurements are recorded.
