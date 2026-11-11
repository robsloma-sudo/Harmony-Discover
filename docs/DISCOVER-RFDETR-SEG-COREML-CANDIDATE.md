# RF-DETR Segmentation — focused candidate assessment

**Review date:** 2026-11-11  
**Status:** leading candidate for a controlled Core ML prototype; not yet approved for production  
**Target:** Harmony Discover DEV, standard iPhone 17

## Why this is now the leading candidate

The official Roboflow RF-DETR repository explicitly states that the RF-DETR package and every RF-DETR-Seg size (Nano through 2XLarge) are Apache 2.0, and that those segmentation sizes may be used in closed-source commercial products and self-hosted deployments. The repository's LICENSE file is Apache License 2.0.

- Official repository: https://github.com/roboflow/rf-detr
- Official license: https://github.com/roboflow/rf-detr/blob/develop/LICENSE
- Core ML export guide: https://github.com/roboflow/rf-detr/blob/develop/docs/exports/coreml.md
- Instance-segmentation model guide: https://github.com/roboflow/inference/blob/main/inference_models/docs/models/rfdetr-instance-segmentation.md

This avoids the known Ultralytics AGPL blocker for the initial model candidate. It does not mean every dependency, pretrained checkpoint, training dataset or future artifact is automatically cleared; each must still be recorded and reviewed. Preserve Apache 2.0 notices and modifications as required.

## Specific model to evaluate first

Start with **RFDETRSegNano**, then compare RFDETRSegSmall only if Nano masks fail the pilot quality gate.

The upstream repository currently documents these segmentation model sizes:

| Model | Parameters | Input resolution | COCO AP50:95 | Upstream note |
|---|---:|---:|---:|---|
| RFDETRSegNano | 33.6M | 312×312 | 40.3 | Apache 2.0 |
| RFDETRSegSmall | 33.7M | 384×384 | 43.1 | Apache 2.0 |
| RFDETRSegMedium | 35.7M | 432×432 | 45.3 | Apache 2.0 |
| RFDETRSegLarge | 36.2M | 504×504 | 47.1 | Apache 2.0 |

These are upstream COCO benchmark results, not bottle accuracy and not iPhone performance. The parameter count is relatively large for an on-device real-time scanner, so do not assume Nano will be sufficiently fast or memory-efficient on iPhone 17. It is simply the smallest documented segmentation variant and the rational first experiment.

## Core ML path exists, but is experimental

The upstream RF-DETR Core ML export guide documents native .mlpackage export for segmentation:

- Install the optional Core ML export dependencies on a supported Mac.
- Instantiate RFDETRSegNano or RFDETRSegSmall.
- Export with format="coreml".
- Export float16 when evaluating Neural Engine execution.
- The documented segmentation outputs are positional: detections, labels and masks.
- Native Core ML export is explicitly marked experimental/work-in-progress.
- Fixed input shapes are required; dynamic batch is not supported.
- Upstream notes that Core ML numerical differences can reorder close top-k scores. Validate post-processed masks/detections against the PyTorch reference rather than expecting raw tensor equality.
- The upstream docs show Apple Silicon Mac measurements, not iPhone 17 measurements.

The first experiment must therefore include export reproducibility, output decoding, mask quality parity, model load time, cold/warm latency, sustained camera throughput, memory and thermal behavior on the actual target phone.

## Important technical limitation

RF-DETR is a fixed-class instance segmenter. A COCO-pretrained checkpoint is not a bar-bottle model. It must be fine-tuned on our own consented, correctly annotated bottle/container dataset with a suitable class taxonomy and hard negatives.

Suggested initial classes:
- bottle
- can
- glass
- shaker
- decanter
- jar_or_carafe
- bar_tool_or_prop
- other

For the first narrow model experiment, it may be better to train bottle vs non-bottle (with explicit hard negatives) and keep product/SKU identity entirely separate. Do not overload segmentation with brand, vintage, package size or liquid-level classification.

## Required checks before using a checkpoint

1. Pin an immutable RF-DETR repository release/commit and preserve the Apache 2.0 license and notices.
2. Record the exact checkpoint source, version, checksum and model metadata.
3. Determine the exact pretrained backbone/checkpoint provenance and applicable terms.
4. Use only a training dataset with documented rights for commercial model training; do not assume COCO, Trans10K, ClearGrasp or any third-party image set can be combined without review.
5. Keep training/export dependencies in a separate build environment; do not add PyTorch or Core ML conversion packages to the mobile app.
6. Export .mlpackage on a compatible Apple Silicon Mac. No such export has been performed in this task.
7. Compare PyTorch and Core ML post-processed instance masks on the same held-out images.
8. Integrate into Discover only after target-device profiling and rights approval.

## Decision

**Promote RFDETRSegNano to first-place technical evaluation candidate, not production selection.** Keep the current model-neutral Discover segmentation contract. Do not add a model adapter, weight file, dependency or camera behavior until an actual exported artifact has passed license/provenance review, output-contract inspection, held-out bottle tests and physical iPhone profiling.

## Source review snapshot

The official repository was fetched on 2026-11-11. Its README documents the Apache 2.0 license for all RF-DETR-Seg sizes and the Core ML export guide documents segmentation export and its experimental status. Upstream measurements are not transferable to the iPhone 17; all performance claims must be independently measured on the target device.
