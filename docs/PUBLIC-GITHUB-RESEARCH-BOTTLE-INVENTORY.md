# Public GitHub research: live bottle inventory vision

**Research date:** 2026-11-11  
**Scope:** Public GitHub repositories discoverable by repository/code search and directly inspected README/API metadata. This is a targeted research sweep, not an exhaustive crawl of every public GitHub repository or every file. Search indexing is incomplete and query-dependent.

## Executive conclusion

There is no single public repository found that solves the complete Discover problem: rapid mobile bar-shelf video capture, bottle instance segmentation, exact bottle/SKU/capacity identification, persistent unique bottle tracking, visible liquid-line detection, calibrated internal-volume estimation, and commercial iPhone deployment.

There are, however, useful building blocks:
1. A direct bottle liquid-level research implementation with annotated examples and honest baseline metrics.
2. A real-time bottle detection + ByteTrack + liquid-gradient pipeline designed for conveyor inspection.
3. Transparent-object segmentation/depth datasets that can help with clear bottles and glass.
4. Retail shelf detection + crop embeddings + OCR/retrieval methods for SKU recognition.
5. Core ML model catalogues and iOS integration examples.
6. Stronger production patterns for abstention, unknown queues, offline capture, replay evaluation and evidence fusion.

**Recommendation:** use these repositories as references and validation baselines; do not wholesale copy an entire pipeline or assume their pretrained weights recognize our bottle catalogue.

## Highest-value repositories

### 1. Bottle fill-level classical CV — direct match for liquid-line research
- Repository: https://github.com/maabra/bottle-fill-level-detection
- Latest inspected metadata: pushed 2026-10-15; public; no repository license declared in GitHub API.
- What it does: bottle localization, liquid-air boundary detection, fill-percentage estimation, OpenCV/NumPy; compares CIELAB gradients, RGB gradients, K-means and Chan–Vese.
- Dataset: 36 photographs, 65 manually annotated bottles; glass/plastic, transparent/colored contents, grouped and single bottles, multiple lighting/background types; fill range roughly 18–86%.
- Reported results: CIELAB precision 0.696/recall 0.492; K-means recall 0.600; Chan–Vese fill-level MAE 14.53 percentage points on matched bottles; ensemble reported 44 detections and 14.2 pp MAE. Metrics are on a small thesis dataset and matched detections only.
- Useful files: `algoritmi/lab_euklidska.py`, `rgb_euklidska.py`, `kmeans_euklidska.py`, `chanvese_euklidska.py`, `common.py`, `evaluacija/ground_truth.json`, evaluation scripts.
- Relevance: strongest direct liquid-boundary baseline found; use to compare optical approaches and test failure modes.
- Limitations: small dataset; bounding-box-height fill percentage is not volume percentage; shape-based volume approximation is explicitly uncalibrated; not an iOS implementation.
- License decision: no license detected. Treat as all-rights-reserved until author grants permission. Do not copy source, annotations or images into Discover without permission.

### 2. BTLES / BottleVision — bottle video tracking and liquid-level baseline
- Repository: https://github.com/Shamlan321/BTLES
- Metadata: MIT repository license; last pushed 2026-03-31; small project (3 stars at inspection).
- Pipeline: YOLOv8s bottle detector → ByteTrack track IDs → crop → Gaussian blur/grayscale → vertical intensity profile/steepest gradient → fill-line threshold/pass-reject; includes a calibration UI.
- Training guidance: custom bottle dataset; README suggests at least 200 images; YOLO training recipe and configuration are present.
- Relevance: concrete starting reference for continuous frame processing, unique track IDs, one-time processing and adjustable liquid-line threshold.
- Limitations: conveyor/inspection model, not dense bar shelf inventory; line detection relies on intensity gradient and may fail on clear liquid, opaque/frosted containers, labels, reflections and uneven illumination; estimates a threshold decision, not calibrated remaining mL; PyQt desktop, not Core ML. MIT code license does not automatically relicense third-party YOLO code or model weights. Verify weight provenance and Ultralytics terms before use.

### 3. LiquidMonitorAI — semantic segmentation for bottles, glasses, wine and liquid
- Repository: https://github.com/IsiPaz/LiquidMonitorAI
- Metadata: MIT repository license; last pushed 2025-06-03.
- README lists YOLOv11 segmentation weights (nano/small/medium), a Roboflow LiquiContain dataset, and labels `glass`, `wine`, `bottle`, `liquid`.
- Relevance: potentially useful training-label taxonomy and a direct semantic segmentation baseline for bottle/liquid regions.
- Limitations: README expects PyTorch/CUDA and image/video/webcam input, not iOS Core ML; dataset terms need separate verification; MIT code license does not automatically cover the dataset, model weights, Ultralytics dependency or Roboflow data. The exact training/evaluation quality must be independently verified. The repository README does not establish robust package/SKU recognition or calibrated volume estimation.

### 4. Trans10K — transparent object segmentation
- Code: https://github.com/xieenze/Segment_Transparent_Objects
- Project/data: https://xieenze.github.io/projects/TransLAB/TransLAB.html
- GitHub metadata: Apache-2.0 code repository; 112 stars at inspection; last pushed 2022-12-10.
- Dataset: 10,428 images, including transparent bottles, cups and glass objects plus transparent stuff (windows, glass walls); train/validation/test split documented by project.
- Relevance: useful pretraining/evaluation for transparent-object boundaries and glass bottle appearance.
- Limitations: not alcohol-product-specific; older research code; dataset and pretrained model terms should be checked independently; semantic transparent-object masks do not identify SKU or liquid level.

### 5. ClearGrasp — transparent object depth and geometry
- Code: https://github.com/Shreeyak/cleargrasp
- Data: https://sites.google.com/view/cleargrasp/data
- GitHub metadata: Apache-2.0 code repository; 332 stars at inspection; last pushed 2021-12-06.
- Dataset: over 50,000 photorealistic transparent-object renders with masks, edges, surface normals and depth; 286 real-world test images with ground-truth depth.
- Relevance: potential research data for clear bottle segmentation, edge recovery and depth/shape reasoning.
- Limitations: older RGB-D/robotics research pipeline; synthetic-to-real gap; not directly deployable on iPhone; transparent objects are not necessarily bottles; requires independent dataset/model license review.

### 6. ShelfSet shelf-object-detector — mobile retail detector
- Repository: https://github.com/ShelfSet/shelf-object-detector
- Metadata: MIT repository license; last pushed 2026-09-09.
- README claims a 6,262-image custom dense retail dataset and model artifacts: PyTorch server model, Android TFLite and iOS Core ML `.mlpackage`. It describes Core ML + Apple Vision integration and a 1280×1280 input.
- Relevance: potentially the fastest iOS integration experiment for generic dense product localization; mobile artifact and inference path may save engineering time.
- Limitations: model output is boxes, not instance masks; trained for generic CPG products, not verified bar bottles/SKUs; benchmark claims require independent reproduction; weights and dataset are hosted outside GitHub on Google Drive, so provenance/terms must be checked separately. MIT code license does not establish model/data license. Do not use as bottle segmentation without retraining and evaluation.

### 7. Shelf product identifier — SKU crops + image embeddings
- Repository: https://github.com/albertferre/shelf-product-identifier
- Metadata: MIT repository license; 74 stars; last pushed 2025-11-11.
- Pipeline: YOLOv8 + SKU-110K to locate facings; crop each product; image embeddings + cosine similarity to cluster/identify known products; manual knowledge base maps clusters to product names.
- Relevance: strong architecture pattern for separating instance localization from product identity retrieval. This fits our separate catalog-agent boundary: crop/embedding retrieval can return candidate SKUs to a verified catalogue rather than forcing classification in the detector.
- Limitations: static retail shelf photos; not liquid state; SKU-110K is a generic retail shelf dataset and may not include alcohol bottle diversity; model family licensing must be checked; README notes product knowledge base coverage limits and gives a misclassification example.

### 8. Grocery Dataset — retail shelf crops and annotations
- Repository: https://github.com/gulvarol/grocerydataset
- Dataset: 354 shelf images from ~40 groceries and 4 cameras, 10 product categories, product crops, brand/logo crops, shelf annotations and negative category.
- Relevance: legacy data/annotation format and negative examples for retail recognition.
- Critical restriction: repository README states research-only, not commercial use. Do not use for commercial Harmony Discover training or validation without a separate license grant.

### 9. Retail shelf intelligence prototype — OCR + embeddings + abstention
- Repository: https://github.com/Dhavalnvm/Self-organizer
- Pipeline described: generic shelf detection, CLIP zero-shot/embedding KNN brand classification, EasyOCR shelf labels/price tags, share-of-shelf metrics.
- Relevance: useful modular ideas for combining image retrieval, OCR and downstream reporting.
- Limitations: prototype; not bottle-specific; model/data licenses need inspection. No reason to port its full backend into Discover.

### 10. Retail shelf detection case study — evidence fusion and unknown queue
- Repository: https://github.com/swd07/retail-shelf-detection
- Describes OCR/VLM evidence, dense embedding retrieval, structured attribute reranking, unknown inbox, human review/promotion, golden sets, replay evaluation, abstention and offline capture.
- Relevance: architecture patterns align strongly with our need to distinguish sibling SKUs (brand, product, size, package type), keep provenance and refuse uncertain matches.
- Limitations: public repository is a case-study/reference with some private production components; not a ready-made bottle model. Inspect license and exact included code before reuse.

### 11. Dense shelf detection and visual pseudo-labeling
- Repository: https://github.com/Adnanwadee/retail-shelf-dense-product-detection
- Pipeline: YOLOv8m/RT-DETR, DINOv2 embeddings, MiniBatch K-means pseudo-labels, crop classifier and audit dashboard.
- Relevance: potential reference for unsupervised grouping of bottle crops before the product catalogue is fully populated.
- Limitations: repository says no open-source license is granted and trained weights/full dataset are excluded. Do not reuse code or artifacts without permission. Pseudo-labels are not verified commercial SKUs.

### 12. Core ML model catalogue and sample apps
- Repository: https://github.com/john-rocky/CoreML-Models
- Lists Core ML image classifiers, object detectors, segmentation models, ByteTrack, MobileSAM, SAM2-Tiny, monocular depth models and iOS sample projects.
- Relevance: useful model discovery and Core ML integration reference. Could shortlist permissively licensed candidate architectures and compare package sizes.
- Limitations: each model follows its original project's license; downloadable artifacts may be hosted externally. The repository itself is not a blanket license for every model. Verify each exact weight and training-data license.

### 13. MIT Princeton APC vision toolbox — multi-view geometry
- Repository: https://github.com/andyzeng/apc-vision-toolbox
- Metadata/README: Simplified BSD code license.
- Pipeline: RGB-D object segmentation, multi-view self-supervised data generation, 6D pose estimation and fitting scanned 3D models to segmented objects.
- Relevance: concepts for associating multi-view observations with a known 3D object model and pose, plus self-supervised annotation generation.
- Limitations: old ROS/Matlab/RealSense research stack; not iPhone-ready; hardware requirements and dataset terms differ; likely overkill for first mobile scanner milestone.

### 14. MAttNet — region proposals and masks
- Repository: https://github.com/lichengunc/MAttNet
- Metadata/README: MIT code license; old PyTorch 0.2 / Python 2.7 / CUDA 8 stack.
- Relevance: historical research reference for mask-based object proposals and visual context, not a deployable current model.
- Limitations: primarily referring-expression/person-heavy datasets; obsolete runtime; not suitable for direct port.

## Best concepts to reuse in our architecture

### A. Detection and identification must be separate
Use a generic bottle-instance detector/segmenter to find each physical bottle. Then crop multiple sharp frames and query a catalogue-backed visual retrieval index. Fuse OCR/barcode/label evidence with image embeddings and structured attributes. Exact capacity and SKU variant must be confirmed separately.

### B. Tracking is not identity
ByteTrack-style association is useful for maintaining a session-local track during a sweep and preventing double-counting. Track IDs expire when continuity is lost. Revisited bottles need multi-view re-identification and spatial/scene context; a tracker ID alone is not a permanent bottle identity.

### C. Liquid-line estimates should abstain
The classical and YOLO+ByteTrack projects show practical optical methods, but their reported results are not sufficient for inventory-grade mL estimates. A visible line must be stable across frames and mapped to a calibrated bottle-specific internal profile. Fill-height percentage is not volume percentage.

### D. Transparent bottle data is its own domain
Use Trans10K/ClearGrasp as research pretraining/benchmark references only after licensing review. Add real bar footage with glass, clear spirits, dark spirits, condensation, reflective shelves, backlighting, labels and hands. Generic COCO bottle masks will not cover all these cases.

### E. Keep unknowns and reviewer corrections
Build a private low-confidence review queue. Preserve original crops, model versions, frame IDs, OCR snippets, retrieval candidates, user corrections and calibration provenance. Corrections should improve the visual reference gallery without silently rewriting canonical catalogue data.

### F. Evaluate by bottle family and operating condition
Track false detections per sweep, missed bottles, duplicate count, mask IoU, exact SKU accuracy, capacity accuracy, liquid-line vertical error, remaining-volume MAE/percentage error, abstention rate, and latency/thermal behavior on the actual iPhone 17. Split datasets by physical bottle and capture session, not adjacent frames.

## Proposed short list for hands-on evaluation

1. **Liquid boundary baseline:** port the mathematical/optical ideas from `maabra/bottle-fill-level-detection` into a disposable test harness after permission is granted, or reimplement the documented methods independently. Compare against our liquid consensus gate. Do not copy its unlicensed code/data.
2. **Video tracking baseline:** reproduce the BTLES detection → ByteTrack → crop → liquid-line flow on sample videos, but replace the conveyor trigger with shelf-sweep track lifecycle and test occlusion/re-entry.
3. **Transparent-object pretraining:** evaluate Trans10K and ClearGrasp data/model options under their exact licenses.
4. **SKU retrieval baseline:** adapt the two-stage detection + embedding retrieval idea from `shelf-product-identifier`, with Harmony catalogue IDs as labels and explicit unknown/review states.
5. **iOS model experiment:** investigate ShelfSet's Core ML artifact as a generic shelf-localization speed baseline only after checking weight/data rights. It does not satisfy instance segmentation or bottle-class requirements as published.
6. **Native inference adapter:** build the Core ML adapter only after selecting an artifact with verified license, class taxonomy, output format, model version and held-out bar-shelf benchmark.

## License and provenance rules

- Public GitHub visibility does not mean public-domain or commercially reusable.
- A repository license may cover code but not model weights, datasets, images, Roboflow projects, or dependencies.
- Explicitly research-only data (Grocery Dataset) is not cleared for commercial use.
- No license declared means no permission to copy/reuse.
- AGPL-dependent model stacks require separate review before proprietary deployment.
- Preserve source URL, commit SHA, license file/version, model checksum, dataset terms, attribution and modifications for every artifact considered.
- Do not download or bundle third-party model weights until approval.

## What this means for Harmony Discover

The most valuable next step is not adding a generic detector to the current AR rectangle UI. It is a controlled model bake-off with:
- A representative bar-shelf test set.
- Bottle segmentation and liquid-line annotations.
- A generic product detector baseline.
- A bottle-specific instance-segmentation candidate.
- A separate SKU visual retrieval candidate.
- The same held-out capture sessions for all models.
- An on-device Core ML benchmark on the target iPhone.

No third-party source code, dataset, model weights, or external images were copied into this repository by this research note. No production app/database changes, uploads, merge or deployment were performed.
