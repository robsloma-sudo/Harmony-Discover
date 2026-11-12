# Live D-FINE camera integration

This change connects the verified browser D-FINE ONNX/WASM provider to the existing live viewfinder.

## Runtime flow

1. The camera session lazily loads the checksum-verified model and one WASM inference session.
2. Each scheduled cloud recognition pass captures one cropped frame and timestamps it once.
3. The exact same frame is used for cloud bottle recognition and local segmentation inference.
4. Cloud bottle detections seed persistent visual tracks. D-FINE masks are associated to those tracks only when timestamps, confidence, overlap, and ambiguity checks pass.
5. Only measured mask contours are emitted to the live overlay. Previously measured contours may be warped with their matching persistent track; a rectangle never becomes a silhouette.

## Resource and stale-result policy

- One inference at a time via SegmentationRunner.
- At least 2.2 seconds between inference starts.
- Maximum frame age 1.6 seconds.
- Maximum eight tracks per frame.
- Model session is disposed when the camera component stops.
- Failed or rejected inference leaves the existing box tracking intact and emits no fabricated contour.

## Scope

This is the browser WASM path. It does not add native iOS segmentation, metric depth, or a 3D bottle mesh. D-FINE currently refines cloud-seeded bottle tracks; it does not independently create bottle tracks or perform per-bottle high-resolution label OCR. The pinned upstream commit states that COCO instance-segmentation weights are Apache-2.0; checkpoint and ONNX hashes are recorded in the model metadata. A held-out bottle-mask evaluation and physical iPhone Safari testing remain release gates. Simulator compilation does not replace physical-device acceptance.
