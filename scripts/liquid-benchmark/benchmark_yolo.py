#!/usr/bin/env python3
"""Optional neural segmentation comparator for the same annotated bottle crops.

Loads LiquidMonitorAI's published YOLOv11 nano segmentation checkpoint and
runs it on the same 65 ground-truth crops used by benchmark.py. The model is
used as an external research comparator only; it is not imported by Harmony
Discover's runtime and is not redistributed by this repository.
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import time
import urllib.request
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

SOURCE = "https://raw.githubusercontent.com/maabra/bottle-fill-level-detection/main"
MODEL_URL = "https://raw.githubusercontent.com/IsiPaz/LiquidMonitorAI/main/weights/lmai-11n-seg.pt"
UA = "Harmony-Discover-LiquidBenchmark/1.0"


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read()


def load_image(filename: str) -> np.ndarray:
    data = fetch(f"{SOURCE}/boce/{filename}")
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Could not decode {filename}")
    return image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="benchmark-results-yolo")
    args = parser.parse_args()
    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)

    annotations = json.loads(fetch(f"{SOURCE}/evaluacija/ground_truth.json"))
    model_path = out / "lmai-11n-seg.pt"
    model_path.write_bytes(fetch(MODEL_URL))
    model = YOLO(str(model_path))
    names = model.names
    names_map = {int(k): str(v).lower() for k, v in names.items()} if isinstance(names, dict) else {
        i: str(v).lower() for i, v in enumerate(names)
    }
    liquid_ids = [i for i, name in names_map.items()
                  if ("liquid" in name or name == "wine" or "fluid" in name)
                  and "glass" not in name]
    rows = []
    if liquid_ids:
        for filename in sorted(annotations):
            image = load_image(filename)
            for index, ann in enumerate(annotations[filename]):
                x, y, w, h = [int(v) for v in ann["bbox"]]
                x0, y0 = max(0, x), max(0, y)
                x1, y1 = min(image.shape[1], x + w), min(image.shape[0], y + h)
                if x1 - x0 < 12 or y1 - y0 < 24:
                    continue
                crop = image[y0:y1, x0:x1]
                truth_ratio = min(1.0, max(0.0, (float(ann["level_y"]) - y0) / max(y1 - y0, 1)))
                start = time.perf_counter()
                prediction = model.predict(crop, imgsz=384, conf=0.15, device="cpu", verbose=False)[0]
                elapsed = (time.perf_counter() - start) * 1000.0
                best_mask = None
                best_area = 0
                if prediction.masks is not None and prediction.boxes is not None:
                    cls_ids = prediction.boxes.cls.cpu().numpy().astype(int)
                    masks = prediction.masks.data.cpu().numpy()
                    for cls_id, mask in zip(cls_ids, masks):
                        if cls_id not in liquid_ids:
                            continue
                        full_mask = cv2.resize(mask.astype(np.float32), (crop.shape[1], crop.shape[0]),
                                               interpolation=cv2.INTER_LINEAR) >= 0.5
                        area = int(full_mask.sum())
                        if area > best_area:
                            best_area, best_mask = area, full_mask
                if best_mask is None or best_area < max(12, int(crop.shape[0] * crop.shape[1] * 0.002)):
                    rows.append({
                        "image": filename, "bottle_index": index,
                        "status": "no_liquid_mask", "truth_fill_pct": round((1-truth_ratio)*100, 3),
                        "predicted_fill_pct": "", "absolute_error_pp": "",
                        "runtime_ms": round(elapsed, 3), "mask_area_px": best_area,
                    })
                    continue
                # Ignore isolated one-pixel noise: a row must occupy at least 2% of crop width.
                row_counts = best_mask.sum(axis=1)
                active = np.where(row_counts >= max(2, int(crop.shape[1] * 0.02)))[0]
                if len(active) == 0:
                    pred_ratio = None
                else:
                    pred_ratio = float(active.min()) / max(crop.shape[0], 1)
                if pred_ratio is None:
                    rows.append({
                        "image": filename, "bottle_index": index,
                        "status": "mask_without_stable_boundary", "truth_fill_pct": round((1-truth_ratio)*100, 3),
                        "predicted_fill_pct": "", "absolute_error_pp": "",
                        "runtime_ms": round(elapsed, 3), "mask_area_px": best_area,
                    })
                else:
                    pred_fill = (1 - pred_ratio) * 100
                    truth_fill = (1 - truth_ratio) * 100
                    rows.append({
                        "image": filename, "bottle_index": index,
                        "status": "liquid_mask_detected", "truth_fill_pct": round(truth_fill, 3),
                        "predicted_fill_pct": round(pred_fill, 3),
                        "absolute_error_pp": round(abs(pred_fill - truth_fill), 3),
                        "runtime_ms": round(elapsed, 3), "mask_area_px": best_area,
                    })

    csv_path = out / "per-bottle.csv"
    fields = ["image", "bottle_index", "status", "truth_fill_pct", "predicted_fill_pct",
              "absolute_error_pp", "runtime_ms", "mask_area_px"]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    detected = [r for r in rows if r["status"] == "liquid_mask_detected"]
    errors = [float(r["absolute_error_pp"]) for r in detected]
    times = [float(r["runtime_ms"]) for r in rows]
    result = {
        "model": "LiquidMonitorAI lmai-11n-seg.pt",
        "model_source": MODEL_URL,
        "model_file_size_bytes": model_path.stat().st_size,
        "class_names": names_map,
        "liquid_class_ids": liquid_ids,
        "ground_truth_bottle_crops": len(rows),
        "liquid_masks_detected": len(detected),
        "liquid_mask_coverage_pct": round(100 * len(detected) / max(len(rows), 1), 1),
        "missed_or_unusable_masks": len(rows) - len(detected),
        "mae_percentage_points_on_detected_only": round(statistics.mean(errors), 3) if errors else None,
        "median_absolute_error_pp_on_detected_only": round(statistics.median(errors), 3) if errors else None,
        "within_10pp_on_detected_only_pct": round(100 * sum(e <= 10 for e in errors) / len(errors), 1) if errors else None,
        "mean_cpu_runtime_ms_per_crop": round(statistics.mean(times), 3) if times else None,
        "median_cpu_runtime_ms_per_crop": round(statistics.median(times), 3) if times else None,
        "p95_cpu_runtime_ms_per_crop": round(float(np.percentile(times, 95)), 3) if times else None,
        "scope": "Same ground-truth bottle crops as the classical benchmark; model predicts liquid segmentation only.",
        "limitations": [
            "This is a CPU Linux benchmark, not iPhone runtime.",
            "MAE is conditional on a usable liquid mask; coverage must be considered alongside MAE.",
            "The external checkpoint's independent commercial license and training-data rights are not established here.",
            "The external YOLO/Ultralytics dependency has AGPL licensing implications; this is an isolated research evaluation, not production integration.",
            "The dataset is not liquor-backbar-specific and its license is unclear; data is fetched transiently and not redistributed.",
        ],
    }
    (out / "summary.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    if not liquid_ids:
        lines = [
            "# LiquidMonitorAI neural comparator",
            "",
            f"- Model class names: `{names_map}`",
            "- **Not comparable:** the checkpoint did not expose a recognized liquid/wine segmentation class.",
        ]
    else:
        lines = [
            "# LiquidMonitorAI neural comparator",
            "",
            f"- Ground-truth crops: **{len(rows)}**",
            f"- Usable liquid masks: **{len(detected)} ({result['liquid_mask_coverage_pct']}%)**",
            f"- MAE on detected masks only: **{result['mae_percentage_points_on_detected_only']} pp**",
            f"- Median CPU time: **{result['median_cpu_runtime_ms_per_crop']} ms/crop**",
            f"- p95 CPU time: **{result['p95_cpu_runtime_ms_per_crop']} ms/crop**",
            "",
            "MAE excludes missed/unusable liquid masks; always interpret it together with coverage.",
            "This is a Linux CPU result, not an iPhone result. The checkpoint's commercial rights are unverified.",
        ]
    (out / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"Model class names: {names_map}")
    print(f"Results written to {out.resolve()}")


if __name__ == "__main__":
    main()
