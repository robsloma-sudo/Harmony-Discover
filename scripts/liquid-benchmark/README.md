# Harmony Discover liquid-level benchmark

This isolated research harness compares three independent liquid-boundary estimation baselines on the same manually annotated bottle crops:

1. CIELAB vertical colour-gradient profile
2. Two-cluster Lab + saturation K-means segmentation
3. Chan-Vese two-region segmentation

## Dataset

The benchmark fetches the 36 photographs and 65 manually annotated bottle bounding boxes / liquid-boundary positions from the public research repository:

- https://github.com/maabra/bottle-fill-level-detection
- Ground truth: `evaluacija/ground_truth.json`
- Images: `boce/*.webp`

The source repository's README reports a 36-image / 65-bottle dataset and provides the annotations. Its repository does not expose a clear license file. For that reason, this harness fetches the data transiently at runtime for comparative evaluation only. It does not commit, redistribute, train on, or package those images or annotations. This dataset must not be used for commercial model training or product distribution unless the rights holder grants permission.

## Run

Python 3.11 is recommended.

```bash
python -m pip install -r scripts/liquid-benchmark/requirements.txt
python scripts/liquid-benchmark/benchmark.py
```

Smoke test:

```bash
python scripts/liquid-benchmark/benchmark.py --limit-images 3
```

Neural comparator (separate optional CI job):

```bash
python -m pip install ultralytics==8.3.130
python scripts/liquid-benchmark/benchmark_yolo.py
```

This evaluates the LiquidMonitorAI YOLOv11-nano segmentation checkpoint on the same ground-truth crops. It reports mask coverage as well as MAE on detected masks; a low MAE with poor coverage is not a good result. The checkpoint's independent commercial rights are not established, and Ultralytics carries AGPL licensing implications. This comparator is research-only and must not be integrated into production without a separate license review.

Outputs:
- `benchmark-results/summary.md`
- `benchmark-results/summary.json`
- `benchmark-results/per-bottle.csv`

## First completed result

The first CI run evaluated 36 images / 65 bottle crops. CIELAB gradient: 23.71 pp MAE at 1.46 ms median/crop; Lab+S K-means: 20.75 pp at 4.21 ms; Chan-Vese: 23.07 pp at 57.55 ms. A separate YOLOv11-nano comparator achieved 16.81 pp MAE on its 50 usable liquid masks (76.9% coverage), at 20.66 ms median/crop. Full interpretation and caveats: [`docs/research/liquid-level-benchmark-2026-11-12.md`](../../docs/research/liquid-level-benchmark-2026-11-12.md).

## What this benchmark does and does not prove

All three algorithms receive the same ground-truth bottle crop. This isolates liquid-boundary estimation from bottle detection. It measures fill-height error in percentage points and CPU runtime per crop.

It does **not** measure:
- Bottle localization or segmentation quality.
- Product / brand recognition.
- Multi-frame temporal stability.
- Empty-bottle classification as a separate task.
- Calibrated liquid volume (height fraction is not volume fraction).
- iPhone Safari, WebGPU, Core ML or Android runtime.

Runtime is measured on the GitHub Linux CPU runner and must not be represented as iPhone performance. The dataset is small and not liquor-backbar-specific; a separate Discover bottle benchmark with permission-cleared images is required before product decisions.

## Architecture and production boundary

This is a research-only harness. It does not import into the live scanner, modify Supabase, alter the existing camera pipeline, or change recognition behavior. Results will inform which local ROI algorithm is worth porting into a separate TypeScript implementation.
