# Harmony Discover — 3D Live Scan and Persistent Digital Twin

**Status:** approved product direction; architecture/specification only  
**Target:** Harmony Discover DEV  
**Owner:** Discover scanner workstream  
**Out of scope:** product catalog research/matching (separate agent), Harmony Core/PHG, Harmony Journeys production, production Supabase writes, production deployment.

## Product decision

Build both capabilities as one continuous workflow:

1. **3D Live Scan** is the capture experience. It tracks the physical object while the user moves the camera around it, renders a stable blue spatial overlay, and progressively gathers geometry and text evidence.
2. **Persistent Digital Twin** is the saved result. It retains the reconstructed/estimated object shape, label surfaces, spatial text regions, measurements with provenance, and links to the original scan evidence.

The live experience must create the same structured scan record that the digital-twin viewer later opens. Do not build a decorative AR animation that is disconnected from measured or recognized evidence.

## Product modes

- **Smart Scan:** existing photo-batch workflow; keep it as the reliable fallback.
- **3D Live Bottle:** continuous bottle capture and spatial tracking.
- **Menu Scan:** existing multi-page still-image workflow (up to 12 pages).
- **3D Live Menu:** live page/board detection, perspective correction, optional curved-surface dewarping, and spatial text regions. A flat menu does not need an artificial full 3D mesh; model its page plane and any measured curvature.

Do not expose a mode as available on devices that fail its capability check. If depth/AR support is unavailable, offer a guided multi-angle photo scan and label it clearly as a 2D/multi-view estimate.

## Experience and progressive capture

### Bottle stages

1. **Acquire — full object**
   - Detect and lock the bottle.
   - Track camera pose and object-relative coordinates.
   - Estimate silhouette, height/width proportions, neck/shoulder/base geometry, cap and major label regions.
   - Show a restrained animated blue contour and a visible tracking-quality indicator.

2. **Map — label surface**
   - Ask the user to orbit slowly so the rear and side surfaces become visible.
   - Estimate cylindrical/conical label surface and curvature.
   - Map front, back, neck, shoulder and secondary labels to surface coordinates where evidence supports it.
   - Track label boundaries and artwork regions as polygons, not only axis-aligned rectangles.

3. **Read — typography and detail**
   - Run OCR on sharp, sufficiently large image regions.
   - Store line, word and (where supported) character polygons with confidence and source-frame references.
   - Record typography observations (estimated family/style class, weight, size, spacing and orientation); never claim the exact original font unless it is independently identified from authoritative source data.
   - Prompt for close-up passes when character size, focus, glare or confidence is inadequate.

4. **Reconcile — evidence and identity**
   - Separate visual/OCR confidence from catalog-match confidence.
   - Keep product catalog lookup behind the separate agent's agreed contract.
   - Let the user confirm, correct, reject or mark details unknown.
   - Do not convert OCR text into canonical product facts automatically.

### Menu stages

1. Detect menu/page/board boundaries and stabilize a page coordinate system.
2. Correct perspective and, when needed, estimate page curvature for dewarping.
3. Track sections, columns, lines, prices and text polygons in page coordinates.
4. For multi-page menus, preserve page order and page-to-page evidence.
5. Retain the existing review, correction, venue confirmation and separate opt-in contribution process.

## Technical architecture

### Capture and tracking

- Keep the current Expo/React Native application as the product shell and retain Smart Scan/Menu Pages fallbacks.
- True spatial capture requires native platform capability, not only Expo Camera overlays:
  - iOS: ARKit world tracking; use scene depth/mesh reconstruction only when the device supports it. RealityKit/Metal can render the spatial overlay.
  - Android: ARCore tracking and Depth API where supported; use a GPU/native renderer for stable overlays.
- Implement a capability adapter that reports tracking, depth, mesh and camera support separately. Never infer LiDAR availability from the fact that the device is an iPhone/iPad.
- Start with a native iOS proof of concept on one confirmed device. Add Android after the tracking and data contracts are stable.
- Keep the camera/render loop on-device. Do not send continuous video frames to a server.

### Work scheduling

The display overlay may target the device refresh rate (commonly 60 Hz), but expensive work must not run on every frame:

- Frame-rate loop: pose updates, smoothing, tracked contour rendering and UI feedback.
- Opportunistic vision loop: object/label detection and OCR on selected sharp frames.
- Reconstruction loop: multi-view geometry/depth fusion, lower priority and cancellable.
- Network loop: only explicit still-image/evidence submissions and the existing Discover service calls.

Use temporal smoothing and confidence decay so overlays do not jump, drift or remain falsely locked after tracking is lost. Pause/reacquire visibly when tracking quality falls.

### Reconstruction strategy

Use the simplest representation that meets evidence quality:

- Parametric bottle model for common cylindrical/conical bottles (body profile, shoulder, neck, lip, base, closure).
- Depth/mesh capture when supported and useful.
- Multi-view photogrammetric reconstruction as an optional higher-quality path, not a guaranteed instant result.
- Label surfaces represented as UV-mapped patches attached to the bottle model.
- Menus represented as a page plane or curved surface with page-space text polygons.

Do not promise laboratory-grade dimensions from monocular video. Metric dimensions require calibrated depth/scale or a known reference. Store each measurement's method, units, uncertainty and calibration source. If uncalibrated, store normalized proportions and label dimensions as estimates.

### OCR and typography

- Keep raw OCR output, normalized text, confidence, polygons, frame IDs and timestamps.
- Preserve word/character coordinates only where the OCR engine actually returns them; do not fabricate per-character boxes by splitting a word rectangle.
- Treat font identification as an estimate. Record observed visual attributes separately from a claimed font-family name.
- Tiny text is limited by sensor resolution, focus, motion blur, compression and viewing distance. The UI should guide a closer pass rather than manufacture a confident read.

### Persistent digital twin

A scan record should contain, at minimum:

- scan_id, owner_id, object_kind, created_at, capture_device, app_version.
- capture_capabilities: tracking/depth/mesh support and actual modes used.
- geometry: representation type, mesh or parametric parameters, coordinate frame, scale source and uncertainty.
- surfaces: surface ID/type, UV mapping, boundary polygons and associated image evidence.
- text_regions: text, script/language if detected, line/word/character granularity, polygon, confidence, frame/evidence reference and user correction state.
- measurements: value, unit, method, calibration/reference, uncertainty and confidence.
- observations: labels, materials/finishes, closures, embossing and other visual observations with evidence.
- identity: optional catalog entity reference and separate match score/status; no catalog IDs are invented.
- review: user confirmations, edits, rejected claims and timestamps.
- evidence: private source frames/crops, hashes and capture metadata.

Store large mesh/texture/evidence assets in private Discover storage with owner-scoped access. Store structured metadata in the Discover DEV database. Do not store private photos in public buckets or place their URLs in canonical Harmony records. Retention, deletion and export controls must be defined before release.

## Data and trust boundaries

- Bottle scans and sightings are private to the Discover account by default.
- A saved digital twin is not a contribution grant.
- Menu contribution remains a separate, explicit opt-in and private review process.
- Discover must not write directly to Harmony Core production tables or use Core service-role credentials.
- Future canonical reconciliation must be a separately approved, server-side, auditable and idempotent process with provenance, consent and reviewer decisions.
- Journeys continues to consume approved/canonical entities only. The current cross-origin Journeys initialization contract does not accept arbitrary Discover OCR handoffs; do not fake integration with guessed query parameters.
- The separate catalog agent owns catalog population, SKU research and matching. Scanner work consumes the agreed catalog contract and records the returned match separately from scan evidence.

## Delivery plan and gates

### Phase 0 — capability and device validation
- Confirm the first test device model and OS.
- Verify AR tracking, depth and mesh support independently.
- Produce a native capability report and a camera/AR performance baseline.
- Keep current photo workflows intact.

**Exit:** known-good device matrix and an honest capability/fallback decision.

### Phase 1 — iOS live tracking prototype
- Add the native AR session/camera bridge in a dedicated feature branch.
- Track one bottle and render a stable contour/axis/pose overlay.
- Show tracking state, distance guidance and explicit loss/reacquire behavior.
- Do not add server streaming or catalog calls to the render loop.

**Exit:** stable tracking during a slow orbit, no misleading overlay when tracking is lost, acceptable thermal/battery behavior.

### Phase 2 — label and text mapping
- Detect label surfaces and map boundaries to object coordinates.
- Add selected-frame OCR with line/word polygons and confidence.
- Add guided close-up capture for fine print.
- Compare front/back/side results and suppress unstable duplicates.

**Exit:** repeatable label alignment and traceable OCR evidence; uncertain text remains visibly uncertain.

### Phase 3 — persistent digital twin
- Persist geometry, surfaces, text regions, measurements and evidence.
- Add a viewer to rotate/inspect the twin and select individual text/label regions.
- Add user correction and deletion.
- Verify private storage and owner isolation.

**Exit:** a saved twin can be reopened with source evidence and confidence provenance intact.

### Phase 4 — menu spatial scan
- Add live page/board tracking, perspective correction, optional curvature mapping and page-space text overlays.
- Reuse the existing multi-page review and consent workflow.

**Exit:** stable menu geometry and editable OCR regions; no loss of current 12-page flow.

### Phase 5 — Android and broader device coverage
- Implement ARCore adapter and supported-device matrix.
- Compare tracking/measurement quality with iOS.
- Retain guided multi-photo fallback for unsupported devices.

**Exit:** platform-specific acceptance tests pass and unsupported capabilities are never advertised.

## Acceptance criteria

- The blue overlay is anchored to the tracked object and does not simply animate independently of the camera.
- Tracking loss is visible; stale contours are removed or marked uncertain.
- Overlay rendering remains responsive while OCR/reconstruction work runs asynchronously.
- Every OCR region can be traced to one or more source frames and carries confidence.
- No unsupported character-level boxes, exact-font claims or uncalibrated metric dimensions are presented as facts.
- Bottle and menu scans remain distinct object workflows while sharing evidence and digital-twin infrastructure.
- A saved twin can be reopened, inspected, corrected and deleted by its owner.
- No private observation becomes canonical Harmony/Journeys data without a separate explicit approval/reconciliation path.
- Existing Smart Scan, Menu Pages, private sighting save and menu contribution-consent flows continue to work.

## Immediate next action

Build a native iOS capability probe and one-object tracking prototype first. Before coding native modules, confirm the exact iPhone/iPad model used for testing; LiDAR and supported AR features vary by model. This specification does not authorize production deployment or changes to Harmony Core/Journeys.


## First test device: iPhone 17 (standard, not Pro)

The first target device supplied for this work is **iPhone 17**. Apple’s standard iPhone 17 specifications list the A19 chip, camera sensors, gyroscope and accelerometer, but do not list a LiDAR Scanner. The iPhone 17 Pro specifications do list LiDAR. Therefore the first implementation must not assume LiDAR scene depth or LiDAR mesh reconstruction.

### iPhone 17 implementation profile

- Use ARKit world tracking and camera/IMU motion tracking where supported.
- Probe ARKit support at runtime; do not hardcode device support based only on the marketing model name.
- Treat metric depth and mesh reconstruction as unavailable unless the runtime capability probe positively reports them.
- Use multi-view camera motion, feature tracking, silhouette fitting and parametric bottle geometry for the first 3D prototype.
- Use a known-size reference object or user-entered calibration only when metric dimensions are requested. Otherwise show proportions and explicitly estimated dimensions.
- Keep the live blue contour anchored to tracked image features/object pose. Do not imply a LiDAR-derived mesh.
- Keep close-up still-frame OCR for small print; the live overlay can remain smooth while OCR runs on selected frames.
- Keep Smart Scan and Menu Pages as the immediate fallback if AR tracking is unsupported, interrupted or low-confidence.

### Phase 0 decision

The hardware target is now known well enough to begin an iPhone-first prototype. The next engineering task is a native iOS ARKit capability probe and one-object tracking proof of concept. The probe must report world-tracking support, scene-depth support, smoothed-scene-depth support and scene-reconstruction support independently, plus runtime tracking state. Do not create database tables, upload scans or alter production services for this prototype.

### Device evidence

- Apple iPhone 17 technical specifications: https://support.apple.com/en-us/125089
- Apple iPhone 17 Pro technical specifications (LiDAR listed): https://support.apple.com/en-us/125091
- Apple ARKit scene reconstruction overview: https://developer.apple.com/documentation/ARKit/visualizing-and-interacting-with-a-reconstructed-scene

## Live bar-inventory extension: bottle identity, liquid state and remaining volume

**Product direction:** evolve 3D Live Bottle into a fast, video-based bar inventory workflow. An operator should be able to pan along a back bar or speed rail, with the scanner detecting distinct containers, recognizing products/SKUs, estimating remaining contents and producing a reviewable count. The camera/render loop remains on-device; no continuous video upload.

### Per-object inference pipeline

Treat each physical object as a tracked container hypothesis with independently scored evidence:

1. **Container detection:** bottle/can/other/unknown classification using full silhouette and temporal visual evidence. Generic rectangles are proposal regions only and must never count as bottle detections.
2. **Bottle geometry:** estimate body profile, shoulder, neck, base, width/height ratio, closure and visible label/embossing regions. Track a stable object ID across frames and camera motion.
3. **Product/SKU identity:** use label/OCR evidence and the separate catalog agent's contract. Distinguish package size/SKU variants (e.g. 720 mL, 750 mL, 1 L, 1.5 L) rather than treating brand recognition as capacity recognition. Keep visual identity confidence separate from catalog-match confidence.
4. **Liquid interface:** locate the physical liquid/air boundary within the bottle body, using multiple sharp frames and temporal consistency. Use edge/refraction/appearance cues and bottle geometry; reject printed label graphics, seams, glare, condensation, background edges and reflections. A visible line is evidence, not proof by itself.
5. **Volume calculation:** map the interface height into the bottle's calibrated internal volume profile. For an approximately axisymmetric bottle with internal radius profile r(z), remaining volume is V(z)=π∫[0,z]r(h)^2 dh, with z measured from the internal base to the detected liquid surface. Use a measured/validated internal profile where possible; do not equate fill-height percentage with volume percentage.
6. **Inventory result:** report estimated remaining mL, US fl oz, percent of nominal capacity, package capacity, product identity, confidence and evidence provenance. Preserve uncertainty and abstain when the interface or capacity cannot be trusted.

### Capacity and calibration hierarchy

- First choice: catalog-confirmed exact SKU/package size and a validated bottle-family internal profile.
- Second choice: a previously calibrated digital twin for that exact bottle/package variant, with source and uncertainty recorded.
- Third choice: guided user calibration or known-volume reference, explicitly labeled as user-calibrated.
- Last resort: geometry-only estimate with a broad uncertainty interval; do not present it as an exact milliliter count.
- Nominal capacity is not necessarily brimful internal capacity. Account for headspace, bottle design and manufacturer fill level. Store nominal package size separately from modeled internal capacity.
- Never infer 750 mL merely from a familiar silhouette. 720 mL, 750 mL, 1 L and 1.5 L variants can share nearly identical shapes.

### Optical limits and safeguards

Liquid-interface visibility varies materially:
- Clear spirits in clear glass may provide weak contrast; dark spirits can be easier in some lighting but reflections can mimic a boundary.
- Opaque, frosted, ceramic, metal, heavily tinted or fully wrapped containers may hide the interface.
- Labels can cover the liquid line; the line may only be visible through an unlabelled rear/side window.
- Curved glass causes refraction and apparent line displacement. Camera angle, parallax, highlights, condensation, bubbles, foam and motion blur can corrupt the estimate.
- A bottle can be partially occluded by neighboring stock, speed rails, hands or bar equipment.

Therefore collect several viewpoints while the user pans, choose sharp frames, track the same physical object, and fuse only consistent observations. If the liquid line is not observable, return the state level_unreadable rather than inventing a fill estimate. If confidence is low, prompt for a short close-up/side-angle pass or manual correction.

### Fast bar sweep experience

- User selects a bar area/revenue-center inventory session and starts a guided video sweep.
- Detect and track candidate containers across frames; deduplicate the same physical bottle seen in adjacent frames or from multiple angles.
- Prioritize wide, sharp frames for counting and SKU labels; request targeted close-ups only for unresolved identity or liquid level.
- Show a live progress rail: detected containers, confirmed products, unreadable labels, unreadable liquid levels and duplicates/occlusions.
- Generate a draft inventory grouped by SKU/package size, with bottle count and estimated remaining volume; keep each bottle-level observation inspectable.
- Require review for ambiguous SKU, package size, hidden liquid line, low confidence or possible duplicate. Do not silently round uncertainty into exact stock.
- Support rapid manual overrides and preserve the original model estimate plus user correction.

### Proposed per-bottle observation contract

Each observation should include:
- observation_id, scan_session_id, private owner_id, track_id, timestamps and capture device/capabilities.
- container_class, classifier score, geometry profile and geometry confidence.
- product_match_ref (optional), package capacity in mL, package-size source, SKU match score/status.
- liquid_interface: visible/unreadable/occluded/ambiguous, normalized interface coordinates, source frame IDs, multi-frame agreement and confidence.
- remaining_volume_ml, remaining_volume_us_fl_oz, remaining_percent, uncertainty interval, calculation method and calibration/profile reference.
- evidence frame/crop references, model/version identifiers, user review state and correction history.
- explicit estimated vs measured status. A camera-derived fill estimate is not a physical measurement.

This is a proposed Discover DEV contract only; it does not authorize database migrations, uploads, or production writes.

### Acceptance gates for inventory use

- Distinguish bottle-shaped containers from arbitrary rectangular objects on a representative bar scene.
- Keep one physical bottle as one track during a continuous sweep; avoid duplicate counts when the camera revisits it.
- Demonstrate liquid-interface detection across clear, dark, tinted and opaque packaging, and explicitly abstain where it is not visible.
- Validate volume estimates against known fill volumes across several bottle geometries and capacities, including 720 mL, 750 mL, 1 L and 1.5 L examples.
- Report error distributions by bottle family, liquid type, lighting and view angle; do not claim one universal accuracy number.
- Test dense shelves, overlapping bottles, label occlusion, backlighting, reflections, condensation, motion blur and partial visibility.
- Only enable automatic inventory export after SKU identity, duplicate suppression and volume estimation each pass separate confidence/accuracy gates.

### Recommended implementation sequence

A. Build a representative validation set with annotated bottle masks, liquid-interface lines, SKU/package capacities and known remaining volumes. Include negative examples such as glasses, shakers, jars, decanters, empty display props and non-bottle rectangular objects.

B. Add bottle/container classification and instance segmentation. Keep generic rectangle proposals as a low-level candidate generator only.

C. Add temporal multi-object tracking and stable world/image association across a sweep. Track IDs must survive short occlusions and viewpoint changes without merging adjacent bottles.

D. Add liquid-interface detection on selected sharp frames. Store line geometry and evidence before attempting volume conversion.

E. Add bottle-family internal profile models and volume integration. Calibrate against known-volume ground truth and retain uncertainty.

F. Integrate product/SKU package size through the separate catalog contract, then produce a reviewable inventory session.

G. Add session persistence and export only after privacy, retention, owner isolation, deletion, review and audit rules are approved.

**Immediate next engineering gate:** do not add a speculative liquid-line detector to the current generic rectangle stream. First define and annotate the bottle/liquid validation dataset and implement a container-instance segmentation interface. This prevents a brittle heuristic from being mistaken for reliable inventory intelligence.