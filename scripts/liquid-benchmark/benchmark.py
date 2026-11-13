#!/usr/bin/env python3
"""Reproducible, same-ROI liquid-boundary benchmark.

Uses the public 36-image / 65-bottle research set published by
maabra/bottle-fill-level-detection. Images and annotations are downloaded
at runtime and are NOT copied into this repository or benchmark artifacts.

The three independent baselines are:
  1. CIELAB vertical colour-gradient profile
  2. Two-cluster Lab+S K-means row-composition transition
  3. Chan-Vese two-region segmentation row-composition transition

All methods receive the same ground-truth bottle crop. This isolates liquid
boundary estimation from bottle detection. It is NOT a full scanner benchmark.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import time
import urllib.request
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
from skimage.segmentation import chan_vese

REPO = "https://raw.githubusercontent.com/maabra/bottle-fill-level-detection/main"
GT_URL = f"{REPO}/evaluacija/ground_truth.json"
USER_AGENT = "Harmony-Discover-LiquidBenchmark/1.0 (research evaluation)"
MAX_W, MAX_H = 144, 288


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=45) as response:
        return response.read()


def fetch_json(url: str):
    return json.loads(fetch_bytes(url).decode("utf-8"))


def load_image(filename: str) -> np.ndarray:
    raw = fetch_bytes(f"{REPO}/boce/{filename}")
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Could not decode source image: {filename}")
    return image


def resize_roi(roi: np.ndarray, max_w: int = MAX_W, max_h: int = MAX_H) -> np.ndarray:
    h, w = roi.shape[:2]
    scale = min(1.0, max_w / max(w, 1), max_h / max(h, 1))
    if scale < 1.0:
        roi = cv2.resize(roi, (max(16, round(w * scale)), max(24, round(h * scale))),
                         interpolation=cv2.INTER_AREA)
    return roi


def smooth_profile(values: np.ndarray, window: int = 7) -> np.ndarray:
    values = np.asarray(values, dtype=np.float32).reshape(-1, 1)
    window = max(3, window | 1)
    return cv2.GaussianBlur(values, (1, window), 0).ravel()


def pick_boundary(score: np.ndarray, height: int) -> tuple[int, float]:
    score = smooth_profile(score)
    lo, hi = max(3, int(height * 0.12)), min(height - 3, int(height * 0.92))
    if hi <= lo:
        return height // 2, 0.0
    local = score[lo:hi]
    idx = int(np.argmax(local)) + lo
    peak = float(score[idx])
    baseline = float(np.median(local)) + 1e-6
    return idx, peak / baseline


def cielab_gradient(roi: np.ndarray) -> tuple[int, float]:
    """Robust multi-segment CIELAB vertical edge profile."""
    h, w = roi.shape[:2]
    lab = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB).astype(np.float32)
    # Bottle side walls are avoided; multiple bands reduce label occlusion.
    left, right = int(w * 0.12), max(int(w * 0.88), int(w * 0.12) + 1)
    lab = lab[:, left:right]
    segments = np.array_split(np.arange(lab.shape[1]), min(12, max(3, lab.shape[1] // 5)))
    profiles = []
    for cols in segments:
        if len(cols) == 0:
            continue
        delta = np.diff(lab[:, cols, :], axis=0)
        magnitude = np.linalg.norm(delta, axis=2)
        profiles.append(np.mean(magnitude, axis=1))
    if not profiles:
        return h // 2, 0.0
    # 65th percentile tolerates some label-covered segments without letting
    # one isolated glare spike dominate the whole bottle.
    score = np.percentile(np.stack(profiles, axis=0), 65, axis=0)
    score = np.pad(score, (0, 1), mode="edge")
    return pick_boundary(score, h)


def kmeans_transition(roi: np.ndarray) -> tuple[int, float]:
    """Two-cluster Lab+S segmentation; locate strongest row-wise class shift."""
    h, w = roi.shape[:2]
    lab = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB).astype(np.float32)
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1:2].astype(np.float32)
    features = np.concatenate([lab, sat * 0.35], axis=2)
    # Normalize channels so saturation does not dominate Lab.
    features[:, :, :3] /= 64.0
    flat = features.reshape((-1, 4)).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 45, 0.15)
    _compactness, labels, _centres = cv2.kmeans(
        flat, 2, None, criteria, 2, cv2.KMEANS_PP_CENTERS
    )
    mask = labels.reshape(h, w)
    # Ignore the outer 12% glass walls and compute cluster occupancy by row.
    x0, x1 = int(w * 0.12), max(int(w * 0.88), int(w * 0.12) + 1)
    profile = np.mean(mask[:, x0:x1] == 1, axis=1).astype(np.float32)
    profile = smooth_profile(profile, 9)
    score = np.abs(np.diff(profile))
    score = np.pad(score, (0, 1), mode="edge")
    return pick_boundary(score, h)


def chan_vese_transition(roi: np.ndarray) -> tuple[int, float]:
    """Chan-Vese two-region mask; estimate its strongest horizontal transition."""
    h, w = roi.shape[:2]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    normalized = gray.astype(np.float32) / 255.0
    mask = chan_vese(
        normalized,
        mu=0.22,
        lambda1=1.0,
        lambda2=1.0,
        tol=1e-3,
        max_num_iter=65,
        dt=0.5,
        init_level_set="checkerboard",
        extended_output=False,
    )
    x0, x1 = int(w * 0.12), max(int(w * 0.88), int(w * 0.12) + 1)
    profile = np.mean(mask[:, x0:x1], axis=1).astype(np.float32)
    profile = smooth_profile(profile, 9)
    score = np.abs(np.diff(profile))
    score = np.pad(score, (0, 1), mode="edge")
    return pick_boundary(score, h)


METHODS: dict[str, Callable[[np.ndarray], tuple[int, float]]] = {
    "cielab_gradient": cielab_gradient,
    "kmeans_lab_s": kmeans_transition,
    "chan_vese": chan_vese_transition,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="benchmark-results")
    parser.add_argument("--limit-images", type=int, default=0,
                        help="Optional smoke-test limit; 0 evaluates the full dataset.")
    args = parser.parse_args()
    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)

    ground_truth = fetch_json(GT_URL)
    filenames = sorted(ground_truth)
    if args.limit_images:
        filenames = filenames[:args.limit_images]

    rows: list[dict] = []
    failures: list[str] = []
    image_count = 0

    for filename in filenames:
        try:
            image = load_image(filename)
        except Exception as exc:
            failures.append(f"{filename}: {exc}")
            continue
        image_count += 1
        for bottle_index, annotation in enumerate(ground_truth[filename]):
            x, y, bw, bh = [int(v) for v in annotation["bbox"]]
            x0, y0 = max(0, x), max(0, y)
            x1, y1 = min(image.shape[1], x + bw), min(image.shape[0], y + bh)
            if x1 - x0 < 12 or y1 - y0 < 24:
                failures.append(f"{filename} bottle {bottle_index}: invalid crop")
                continue
            roi = resize_roi(image[y0:y1, x0:x1])
            truth_abs = float(annotation["level_y"])
            truth_ratio = (truth_abs - y0) / max(y1 - y0, 1)
            truth_ratio = min(1.0, max(0.0, truth_ratio))
            for method_name, method in METHODS.items():
                start = time.perf_counter()
                try:
                    predicted_y, confidence = method(roi)
                    elapsed_ms = (time.perf_counter() - start) * 1000.0
                    predicted_ratio = predicted_y / max(roi.shape[0], 1)
                    error_pp = abs(predicted_ratio - truth_ratio) * 100.0
                    rows.append({
                        "image": filename,
                        "bottle_index": bottle_index,
                        "method": method_name,
                        "truth_fill_pct": round((1.0 - truth_ratio) * 100.0, 3),
                        "predicted_fill_pct": round((1.0 - predicted_ratio) * 100.0, 3),
                        "absolute_error_pp": round(error_pp, 3),
                        "confidence_ratio": round(confidence, 4),
                        "runtime_ms": round(elapsed_ms, 3),
                        "roi_width": roi.shape[1],
                        "roi_height": roi.shape[0],
                    })
                except Exception as exc:
                    failures.append(f"{filename} bottle {bottle_index} {method_name}: {exc}")

    if not rows:
        raise RuntimeError("No benchmark predictions were produced.")

    with (out / "per-bottle.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    summaries = {}
    for method_name in METHODS:
        subset = [r for r in rows if r["method"] == method_name]
        errors = [r["absolute_error_pp"] for r in subset]
        times = [r["runtime_ms"] for r in subset]
        if not subset:
            continue
        summaries[method_name] = {
            "n_bottles": len(subset),
            "mae_percentage_points": round(statistics.mean(errors), 3),
            "median_absolute_error_pp": round(statistics.median(errors), 3),
            "within_5pp_pct": round(100 * sum(e <= 5 for e in errors) / len(errors), 1),
            "within_10pp_pct": round(100 * sum(e <= 10 for e in errors) / len(errors), 1),
            "within_15pp_pct": round(100 * sum(e <= 15 for e in errors) / len(errors), 1),
            "mean_runtime_ms": round(statistics.mean(times), 3),
            "median_runtime_ms": round(statistics.median(times), 3),
            "p95_runtime_ms": round(float(np.percentile(times, 95)), 3),
        }

    result = {
        "dataset": "maabra/bottle-fill-level-detection",
        "dataset_images_evaluated": image_count,
        "ground_truth_bottles_evaluated": len({(r["image"], r["bottle_index"]) for r in rows}),
        "method_predictions": len(rows),
        "roi_max_dimensions": [MAX_W, MAX_H],
        "evaluation_scope": "Known ground-truth bottle crops; liquid-boundary estimation only, not bottle detection.",
        "methods": summaries,
        "failures": failures,
        "important_limitations": [
            "Dataset is small (36 photographs, 65 annotated bottles) and not liquor-backbar-specific.",
            "The dataset repository does not expose a clear license; this benchmark downloads it transiently for evaluation only.",
            "No source images, model weights, or dataset annotations are committed or uploaded as artifacts.",
            "Runtime is measured on GitHub's Linux CPU runner, not iPhone Safari.",
            "Fill percentage is vertical height fraction, not calibrated liquid volume.",
        ],
    }
    (out / "summary.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    lines = [
        "# Liquid boundary benchmark",
        "",
        f"- Images evaluated: **{image_count}**",
        f"- Annotated bottle crops evaluated: **{result['ground_truth_bottles_evaluated']}**",
        "- All methods received the same ground-truth bottle crops.",
        "",
        "| Method | MAE (pp) | Within 5 pp | Within 10 pp | Median ms/crop | p95 ms/crop |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for name, s in summaries.items():
        lines.append(
            f"| {name} | {s['mae_percentage_points']:.2f} | {s['within_5pp_pct']:.1f}% | "
            f"{s['within_10pp_pct']:.1f}% | {s['median_runtime_ms']:.2f} | {s['p95_runtime_ms']:.2f} |"
        )
    lines += [
        "",
        "## Scope and cautions",
        "",
        "This isolates liquid-boundary estimation using manually annotated bottle crops. It does not test bottle detection, product recognition, multi-frame tracking, or phone-camera performance.",
        "The public source dataset has no clearly surfaced license. It is fetched transiently for this evaluation only; no source images or annotations are redistributed.",
        "Runtime numbers are from a GitHub Linux CPU runner, not an iPhone.",
        "",
    ]
    (out / "summary.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    if failures:
        print(f"\nNon-fatal failures: {len(failures)} (see summary.json)")
    print(f"\nArtifacts written to {out.resolve()}")


if __name__ == "__main__":
    main()
