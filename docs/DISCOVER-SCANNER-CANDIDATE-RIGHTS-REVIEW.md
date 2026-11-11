# Discover scanner — candidate rights review snapshot

**Review date:** 2026-11-11  
**Scope:** public project descriptions and vendor licensing pages checked for the initial candidate shortlist. This is an engineering provenance screen, not legal advice or a final legal clearance.

## Findings that change the shortlist

### Ultralytics-derived candidates are not cleared for proprietary Discover use

The current Ultralytics licensing page states that its AGPL-3.0 option is for projects willing to open-source the entire applicable project, and that Enterprise is required for proprietary/commercial products, internal business tools, embedded deployments and private R&D. It also states that trained/fine-tuned Ultralytics models are covered by AGPL-3.0 by default, including models trained from scratch.

Source: https://www.ultralytics.com/license

Implications:
- BTLES/BottleVision uses YOLOv8s. Treat its detector/weights and derivative pipeline as **not cleared** for proprietary Discover until the exact licensing path is approved.
- LiquidMonitorAI uses YOLOv11 segmentation weights. Treat the weights and related Ultralytics components as **not cleared** for proprietary Discover until licensing is resolved.
- ShelfSet's README identifies YOLO26s as its training architecture. Its MIT repository license does not override the separate Ultralytics model/code licensing issue. Do not assume the downloadable Core ML artifact is commercially cleared.

This is a material blocker, not a minor attribution task. Do not import, convert, train, bundle or distribute these candidate weights for Discover while rights are unresolved.

### ShelfSet is a box detector, not an instance segmenter

The public ShelfSet README describes:
- a 6,262-image custom training dataset, including 4,133 scraped high-density shelf images;
- model artifacts hosted in an external Google Drive folder;
- an iOS Core ML model;
- output rows shaped as bounding boxes, confidence and class ID: [x1, y1, x2, y2, confidence, class_id];
- YOLO26s as its training architecture.

Source: https://github.com/ShelfSet/shelf-object-detector

This makes it a possible generic localization speed reference only. It does not satisfy Discover's bottle instance-mask requirement. The model/data artifact provenance and licensing are not established by the public repository's MIT code license. Exclude from deployment selection unless the authors provide explicit artifact-level rights and provenance.

### Roboflow model licensing is separate from repository licensing

Roboflow's current licensing page distinguishes permissive model families from commercial-license-included models and says that some YOLO families require an Enterprise add-on for commercial self-hosting. It also describes AGPL implications for self-hosted YOLO deployments.

Source: https://roboflow.com/licensing

Implication: a README reference to a Roboflow dataset/project or a model exported from Roboflow does not itself prove that Discover can use the underlying dataset, weights or hosted model commercially. Obtain the exact project-level dataset terms and exact model-family license.

## Candidate status after this review

| Candidate | Rights status for proprietary Discover | Technical role |
|---|---|---|
| BTLES / BottleVision | **Not cleared** — YOLOv8s dependency/model path | Tracking and liquid-gradient design reference only |
| LiquidMonitorAI | **Not cleared** — YOLOv11 and Roboflow dataset/weight terms require review | Segmentation taxonomy/reference only |
| ShelfSet shelf-object-detector | **Not cleared** — external artifact/data rights unknown; YOLO26s licensing needs resolution | Bounding-box localization comparison only |
| Trans10K | **Unknown** — exact dataset/model license not yet established | Transparent-object research candidate |
| ClearGrasp | **Unknown** — exact dataset/model license not yet established | Transparent-object geometry/depth research candidate |
| maabra bottle-fill-level-detection | **Not cleared** — no license identified in repository metadata | Published algorithm/results reference only; independently reimplement only after technical review |
| Shelf product identifier | **Conditional / not cleared** — inspect exact code, YOLO model and SKU-110K terms before reuse | Detection + crop retrieval architecture reference |

## Recommended clean path

1. Prefer a model whose **exact architecture, implementation, pretrained weights and training data** each have clear commercial permissions compatible with a closed-source mobile app.
2. Investigate genuinely permissive instance-segmentation candidates independently; do not assume a model catalogue or exporter repo grants rights to every artifact it lists.
3. If no candidate clears, train a small bottle-specific model on a consented dataset with documented commercial training rights and a permissively licensed training/runtime stack.
4. Keep the model adapter vendor-neutral so the scanner can swap model artifacts without changing inventory, tracking, SKU or volume contracts.

## Not yet established

- Exact licenses/terms for Trans10K dataset and all pretrained weights.
- Exact licenses/terms for ClearGrasp datasets, annotations and pretrained weights.
- Exact Roboflow LiquiContain project terms and the provenance/rights of LiquidMonitorAI weights.
- Exact Google Drive ShelfSet model artifact checksum, model card, dataset source rights and distribution terms.
- Whether any of the above authors will grant a separate commercial license.

Until each item is resolved from its authoritative source, its status remains **unknown/not cleared**.
