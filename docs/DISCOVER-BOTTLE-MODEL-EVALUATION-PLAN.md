# Discover live bottle scanner — model evaluation milestone

**Status:** evaluation protocol and artifact gate; no model selected or bundled  
**Target:** Harmony Discover DEV, iPhone 17 standard  
**Branch:** discover-scanner-experience-integration-2026-11-11  
**Date:** 2026-11-11

## Decision

Do not adopt one of the public GitHub projects as the production scanner. Run a controlled, model-neutral bake-off. The first model must provide bottle-aware instance masks, not generic object rectangles. SKU identity, temporal tracking, liquid-line detection and calibrated volume remain separate evidence stages.

No production application, production database, deployment, model download or third-party code import is authorized by this milestone.

## Candidate register

| Candidate | Potential use | Current decision | Blocking evidence |
|---|---|---|---|
| Trans10K | Transparent-object segmentation data/reference | Research candidate only | Exact dataset, pretrained-weight and derivative-use terms need review; not bottle/SKU-specific |
| ClearGrasp | Transparent-object geometry/depth research | Research candidate only | Exact dataset/model terms; synthetic-to-real gap; older RGB-D stack |
| BTLES / BottleVision | ByteTrack lifecycle and liquid-gradient baseline | Architecture reference only | MIT repo license does not clear YOLO dependency/weights; conveyor workflow; no calibrated mL |
| LiquidMonitorAI | Bottle/glass/liquid segmentation taxonomy | Hold pending rights review | Verify exact Roboflow dataset, weights, Ultralytics terms and training provenance |
| ShelfSet Core ML | Mobile dense-product localization speed baseline | Do not adopt as bottle segmenter | Published artifact is boxes, not instance masks; external weight/data provenance unclear |
| Shelf product identifier | Crop embeddings + SKU retrieval architecture | Reuse concept, not canonical data | Verify exact YOLO/model terms; static retail shelf assumptions |
| maabra bottle-fill-level-detection | Liquid boundary algorithm baseline | No code/data reuse without permission | No repository license identified; small dataset and ~14 pp reported fill-height MAE |
| Apple Vision foreground instance mask | Generic foreground proposal helper | Optional comparator only | Not bottle-semantic; must not be counted as a bottle detector |

A repository's code license does not automatically cover model weights, training data, images, hosted downloads, annotations or dependencies. For every artifact, record the exact source URL, immutable commit/tag, license text/version, model card, weight checksum, dataset terms, attribution requirements and dependency licenses. If any of those are unknown, mark the artifact **not cleared** and do not bundle it.

## Stage 0 — rights and provenance gate

Before obtaining or integrating any model artifact, create one record per exact artifact:

- Repository and immutable commit SHA.
- Code license and any additional model license.
- Exact weight URL, publisher, version and SHA-256 checksum.
- Dataset names, source URLs, license/terms and commercial-use restrictions.
- Training-data provenance and known exclusions.
- Dependency licenses, including inference runtime and export tools.
- Required notices, attribution, source disclosure or copyleft obligations.
- Written approval/status: cleared, conditional, denied or unknown.
- Reviewer and review date.

**Stop condition:** no model download, weight conversion, training, bundling or distribution while any required rights field is unknown. Public visibility is not a license grant. Research-only datasets are excluded from commercial training/validation unless separately licensed.

## Stage 1 — representative ground-truth set

Build a small, consented, private pilot set before model selection. Begin with a manageable pilot (for example, 10–15 distinct bar scenes and 100–200 physical containers), then expand only after annotation quality and coverage are reviewed. These are planning targets, not claims about existing data.

### Required capture diversity

- Clear glass with clear spirits; clear glass with dark spirits.
- Clear, green, brown, blue, tinted, frosted, opaque, ceramic and wrapped bottles.
- Whiskey, tequila, vodka, gin, rum, brandy/cognac, liqueurs, wine, beer bottles and cans.
- 720 mL, 750 mL, 1 L and 1.5 L examples, plus other actual package sizes encountered.
- Different shoulders, necks, bases, embossing, closures and label placements.
- Low, medium, high and empty fill states.
- Dense back bars, speed rails, adjacent identical SKUs, partially hidden bottles.
- Warm/cool mixed lighting, backlighting, reflections, condensation, glare, shadows and motion blur.
- Hands, glassware, shakers, decanters, jars, carafes, bar tools, signage and display props as hard negatives.
- Front, side and oblique viewpoints; camera movement and brief occlusions.

### Annotation contract

Each clip/frame should preserve:

- Capture session ID, physical container ID, frame timestamp and device/OS.
- Container class: bottle, can, glass, shaker, decanter, jar, carafe, tool, prop, other or unknown.
- Per-instance mask polygon; optional visible body/neck/shoulder/base landmarks.
- SKU and exact package capacity only when independently verified; otherwise unknown.
- Liquid line: visible, occluded, ambiguous or not applicable; annotate the actual meniscus curve only when visible.
- Ground-truth remaining volume and method. Prefer controlled weighing with container tare and measured liquid density/temperature, or calibrated dispensing. Record uncertainty and units.
- Bottle-family internal profile and calibration source, separate from nominal package capacity.
- Lighting, view angle, distance, focus/motion quality, glare and occlusion tags.

Split train/validation/test by **physical bottle identity and capture session**, not adjacent frames. No frames of the same physical bottle/session should leak across splits. Model predictions must never be used as ground truth. Raw footage remains private, purpose-limited and opt-in; no default training contribution or upload.

## Stage 2 — model bake-off

Compare no more than three candidates initially to keep the test controlled:

1. One rights-cleared, small instance-segmentation model exported to Core ML.
2. One alternative rights-cleared model or clean custom-trained model.
3. Apple's generic foreground mask as a non-semantic comparator only.

Do not select a model based on vendor-reported FPS or a generic benchmark. Measure the complete camera-to-mask path on the standard iPhone 17, including preprocessing, model invocation, mask decoding, confidence filtering and rendering. The target device's runtime capability probe is authoritative; do not assume LiDAR.

### Required metrics

| Stage | Metric |
|---|---|
| Bottle detection | Precision, recall, false bottle instances per complete shelf sweep |
| Segmentation | Instance mask IoU; boundary quality on clear and reflective glass |
| Counting/tracking | Missed bottles, duplicate count, track fragmentation, ID switches, re-entry/revisit deduplication |
| SKU retrieval | Exact SKU match, package-size exact match, top-k candidate recall, unknown/abstention quality |
| Liquid line | Vertical/curve error in calibrated bottle-body coordinates; visible-line coverage |
| Volume | mL MAE, relative error and error distribution by bottle family/fill band/liquid/lighting |
| Safety of estimates | Error among accepted estimates; abstention rate; false confidence rate |
| Device | Cold load, warm inference p50/p95 latency, sustained FPS, memory, thermal throttling and battery impact |

Report all results by container/material/liquid/lighting/occlusion category, not just one aggregate score. For inventory, count accuracy and duplicate suppression are primary; liquid-volume accuracy is a separate release gate. A high abstention rate is acceptable during the pilot if it avoids false inventory.

## Stage 3 — integration sequence

1. **Container segmentation:** return bottle instance masks and separate class/mask confidence through the existing model-neutral contract. Generic Vision rectangles remain proposals only.
2. **Temporal association:** add session-local track lifecycle, occlusion recovery and re-entry handling. A track ID is not a permanent physical identity; do not merge neighboring identical bottles.
3. **SKU evidence:** send selected sharp label crops/OCR/embedding evidence to the separate catalogue contract. Require exact package-size confirmation before grouping as verified SKU inventory.
4. **Liquid interface:** detect a meniscus on selected sharp frames; retain source frame IDs, coordinates, confidence and ambiguity. Do not infer a line from bottle silhouette or printed label.
5. **Volume:** map the line into a validated internal profile and report estimated mL/fl oz/percent with calibration provenance and uncertainty. Nominal capacity is not brimful internal capacity.
6. **Reviewable inventory:** count only confirmed unique physical bottles; preserve unresolved, unreadable and duplicate-review states. Do not automatically export or write to Core production.

## Stage 4 — acceptance gates

No automatic inventory count until all of these pass on held-out physical bottles and sessions:

- Bottle vs non-bottle classification is validated against hard negatives.
- Instance masks are sufficiently stable to support tracking and line registration.
- Continuous sweep does not double-count a bottle after brief occlusion or camera revisit.
- Exact SKU and package size are either independently verified or explicitly unknown.
- Liquid line is visible and stable across independent frames; otherwise return unreadable/ambiguous.
- Volume conversion uses a calibrated internal profile and measured ground truth.
- p50/p95 latency, sustained performance, thermal behavior and memory are acceptable on the standard iPhone 17.
- Model/data rights and artifact provenance are fully cleared.
- User review, private retention and deletion behavior are tested.

Threshold values should be set after the pilot and a cost-of-error review; do not invent accuracy targets before ground-truth data exists.

## Current engineering truth

The current native AR surface still uses Vision rectangle proposals. It does **not** yet detect bottle masks, recognize bottle SKUs, track permanent physical identities, detect liquid pixels or measure volume from camera frames. Existing TypeScript services are validation/evidence gates and a geometry-to-volume calculator; they are not visual inference.

The existing segmentation contract, container evidence, liquid interface, bottle observation and bottle inventory services should remain model-neutral. Do not add a speculative model adapter until a rights-cleared artifact and its exact output contract are known.

## Work intentionally not performed

- No third-party model, source code, weights, dataset or image was copied into Discover.
- No Supabase migration, table, storage bucket, upload or production write.
- No changes to Harmony Core/PHG or Harmony Journeys production.
- No merge, rebase, PR retarget, production deploy or EAS build.
- No claim of CI success, native compilation or physical iPhone acceptance.

## Immediate next action

Obtain a consented, small bar-shelf pilot with verified physical bottle IDs, exact package sizes and measured fill-volume ground truth. In parallel, complete the artifact rights register for candidate models. Only then select and integrate the first Core ML segmentation candidate.
