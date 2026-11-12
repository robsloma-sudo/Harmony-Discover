#!/usr/bin/env python3
"""Prepare a reproducible D-FINE-seg COCO instance-segmentation export config."""

from __future__ import annotations

import argparse
from pathlib import Path

import yaml
from dfine_seg.api.coco_names import COCO_NAMES


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", choices=("n", "s", "m", "l", "x"), default="n")
    parser.add_argument("--config", type=Path, default=Path("config.yaml"))
    parser.add_argument("--output-root", type=Path, default=Path("."))
    args = parser.parse_args()

    coco_names = dict(COCO_NAMES)
    if len(coco_names) != 80 or coco_names.get(39) != "bottle":
        raise SystemExit("Unexpected COCO class map: expected 80 classes and class 39=bottle")

    if not args.config.is_file():
        raise SystemExit(f"Missing D-FINE config: {args.config}")

    config = yaml.safe_load(args.config.read_text())
    config["task"] = "segment"
    config["model_name"] = args.size
    config["exp_name"] = f"harmony_discover_dfine_seg_{args.size}"
    train = config["train"]
    train["root"] = str(args.output_root.resolve())
    train["device"] = "cpu"
    train["img_size"] = [640, 640]
    train["keep_ratio"] = False
    train["conf_thresh"] = 0.5
    train["in_channels"] = 3
    train["label_to_name"] = coco_names
    train["pretrained_model_path"] = f"pretrained/dfine_seg_{args.size}_coco.pt"

    export = config["export"]
    export["from_pretrained"] = True
    export["formats"] = ["onnx"]
    export["half"] = False
    export["max_batch_size"] = 1
    export["dynamic_input"] = False
    export["parity"] = True

    args.config.write_text(yaml.safe_dump(config, sort_keys=False))
    print(f"Prepared {args.config} for D-FINE-seg-{args.size} COCO instance segmentation")
    print(f"Classes: {len(coco_names)}; bottle class ID: 39")
    print(f"Checkpoint: {train['pretrained_model_path']}")
    print("Export: ONNX FP32, static 640x640, batch 1, parity enabled")


if __name__ == "__main__":
    main()
