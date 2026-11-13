# Harmony Discover liquid-level benchmark — 12 November 2026

## Executive result

A same-crop benchmark completed successfully on a public research set containing 36 photographs and 65 manually annotated bottle regions. Every classical method received the same ground-truth bottle crop. The YOLOv11-nano comparator also received those same crops.

The dataset is useful for boundary-estimation research, but it is not a liquor-backbar dataset. Its annotated fill levels are approximately 18–86%; it does not establish empty-bottle classification performance.

## Results

| Approach | Evaluated crops | Boundary MAE | Coverage | Median CPU time/crop | p95 CPU time/crop |
|---|---:|---:|---:|---:|---:|
| CIELAB vertical gradient | 65 | 23.71 pp | 100% emitted estimates | 1.46 ms | 1.79 ms |
| Lab + saturation K-means | 65 | **20.75 pp** | 100% emitted estimates | 4.21 ms | 6.69 ms |
| Chan–Vese segmentation | 65 | 23.07 pp | 100% emitted estimates | 57.55 ms | 77.97 ms |
| LiquidMonitorAI YOLOv11-nano segmentation | 65 | 16.81 pp on 50 usable masks | 76.9% usable-mask coverage | 20.66 ms | 32.21 ms |

**Important comparison note:** the YOLO MAE is calculated only on the 50 crops where the model produced a usable liquid mask. The other 15 crops are misses, not zero-error predictions. Its conditional MAE must not be compared as though it had 100% coverage. The classical implementations always emit a candidate estimate; they do not yet have a calibrated confidence/abstention threshold.

These are independent, simplified implementations of the algorithm families, not copies of the original authors' code. The results are a first benchmark, not a production accuracy claim.

## Interpretation

1. **K-means is the best first classical baseline.** It has the lowest MAE of the three classical methods while remaining inexpensive.
2. **CIELAB is the speed baseline.** At a median 1.46 ms/crop on the Linux runner, it is attractive as a cheap first pass, but its error is higher.
3. **Chan–Vese should not be in the live camera loop.** Its measured latency is much higher and its accuracy did not compensate for that cost in this implementation.
4. **YOLOv11-nano is promising as a confirmation model, not yet as the only detector.** It achieved lower error on masks it found, but missed/unusable masks on 23.1% of crops. A production system must preserve an explicit `unknown` state and use a fast local fallback.
5. **The likely architecture is a cascade:** fast local gradient/colour analysis first, optional segmentation confirmation for uncertain crops, then temporal fusion by bottle track ID. Do not make label or barcode recognition wait for liquid analysis.

## Pretrained-model screening

- **LiquidMonitorAI YOLOv11-nano:** ran successfully on the same 65 crops. The checkpoint is about 6 MB. The model's class map included bottle, glass, liquid and wine-glass. It is the strongest compact neural candidate tested in this pass.
- **TCLD:** not yet benchmarked. Its BezierLaneNet / ResNet34 liquid checkpoint is about 56.9 MB, uses a custom PyTorch stack, and is stored via Git LFS. The repository's environment/README needs cleanup and an explicit code license was not surfaced.
- **Vector-LabPics:** not yet benchmarked. Its ResNet101/PSP-style segmentation model is much heavier (the referenced pretrained archive is hundreds of MB), and the original dataset's third-party image rights require permission for commercial use.

Those two excluded models should not be treated as failures; they remain separate research candidates. They were not run because the dependency/weight/license path was not sufficiently clean for a fair, repeatable CI experiment.

## What this does not establish

- No iPhone Safari, WebGPU, Core ML, or Android runtime numbers.
- No full-frame bottle detection recall; all methods received ground-truth bottle crops.
- No empty-versus-filled classification benchmark.
- No multi-frame persistence or tracking benchmark.
- No calibrated volume measurement. Height fraction is not volume fraction for bottles with shoulders, necks or irregular bodies.
- No liquor-backbar-specific accuracy.

## Data, licensing and production safeguards

The image/annotation set is fetched transiently from the public `maabra/bottle-fill-level-detection` repository. Its repository does not expose a clear license file. It is used here only as a temporary research evaluation source. No source images, annotations or pretrained weights are committed or uploaded as benchmark artifacts. Do not use this dataset for commercial training, product packaging or public distribution unless the rights holder grants permission.

The LiquidMonitorAI code repository is MIT-licensed, but the independent commercial rights of its checkpoint and training data have not been established. Its Ultralytics dependency is AGPL-licensed unless separately covered by a commercial license. The model is evaluated externally only; it is not integrated into Harmony Discover.

This PR changes no live scanner behavior, no Supabase schema/data, and no PHG/Harmony Core production system.

## Next engineering step

Build a permission-cleared Discover bottle test set covering empty, trace, low, partial, high and full levels across clear, green and amber glass, clear and dark liquids, labels, embossed glass, glare, shelf clutter and camera angles. Then port the best local ROI baseline to TypeScript and benchmark it on iPhone Safari/WebGPU/WASM with explicit frame-time and battery measurements. Add the neural confirmation model only if its coverage and mobile latency justify the model cost and license.
