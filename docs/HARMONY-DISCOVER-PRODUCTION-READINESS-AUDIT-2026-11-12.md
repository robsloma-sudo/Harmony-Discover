# Harmony Discover production-readiness audit — 12 November 2026

## Scope and evidence standard

This is a read-only audit of the isolated live-scanner branch, the active Discover DEV Supabase project, and the relevant open pull requests. It records what is implemented, what has CI evidence, and what remains unverified. A source change is not a device validation; a simulator compile is not a physical-device test; an installed schema is not a functioning data pipeline.

**Important recovery note:** prior conversation summaries refer to a 49-task checklist and say it was laid out as seven named stages despite being called a six-phase plan. The original numbered 49-task checklist was not recovered from the accessible repository, Slack channel, or Library. This document does not invent the missing original task numbers. The stage headings below preserve the recovered seven work areas and map them to current repository evidence.

## Environment and safety boundary

- Repository: `robsloma-sudo/Harmony-Discover`
- Active scanner PR: [#32](https://github.com/robsloma-sudo/Harmony-Discover/pull/32)
- PR #32 head branch: `fix/spatial-frame-sync-2026-11-12`
- PR #32 target branch: `feat/persistent-spatial-bottle-tracking`
- Latest inspected PR #32 head: `803f3bee0e14d0f28a6b73a80af9a83f913c15ca`
- Discover DEV Supabase ref: `lqqmwqrffelgnbngrkep`
- Harmony production Supabase ref: `lqjtwabzmgjcufftuqvu` — prohibited target; read-only.
- PR #28 (conservative product identity) remains draft/unmerged.
- No merge, Netlify deployment, Supabase write/migration, Edge Function deployment, or Harmony production change was made during this audit.

## Stage 1 — Stabilize the existing camera/scanner system

**Disposition: source work substantially implemented; physical-device acceptance remains open.**

Implemented and evidenced in PR #32 source:
- Web camera uses `getUserMedia` and waits for an actual playing frame before reporting readiness.
- Camera media tracks, timers, depth sampling and tracking canvases are cleaned up through the camera lifecycle.
- Hidden/background page handling pauses recognition and stops/resumes camera work.
- Native ARKit view preserves requested active state across detach/reattach.
- Recognition generation guards reject stale Vision/cloud callbacks after stop/restart/interruption.
- Preview-only mode does not continue native depth/Vision recognition work.
- Camera remains mounted during capture-review rather than tearing down the AR session.
- Vision text/barcode boxes retain normalized geometry and source ARKit timestamps.
- Vision/cloud evidence pairing uses a bounded 200 ms source-frame tolerance.
- Native interruption/pause/unavailable state clears stale identity and overlay state.

Validation:
- Browser scanner CI passed TypeScript, focused tests, web export and exported-app verification on the recorded feature heads.
- Latest browser refinement commit `803f3bee` was reported green for TypeScript, focused scanner tests, web export and exported-app verification.
- A previous native iOS simulator compile passed on `8c4fc15`; the newest run after `803f3bee` had generated the native project and was installing CocoaPods when last reported.

Open acceptance tasks:
- Test real iPhone Safari camera permission, start/stop, background/foreground, capture-review, orientation and long-session memory.
- Test physical LiDAR-capable iPhone ARKit lifecycle, interruption, relocalization and coordinate orientation.
- Measure memory and CPU over at least a 10-minute scan.
- Expand CI beyond the focused scanner suite: current workflow runs seven named test files, not the complete Vitest suite or Edge Function tests.

## Stage 2 — Build the live tracking engine

**Disposition: two local 2D propagation paths and physical world-point association exist; stable real-world multi-object identity is not yet proven.**

Native iOS:
- Cloud bottle boxes seed Vision `VNTrackObjectRequest` using the retained exact ARKit source pixel buffer and timestamp.
- Persistent `VNSequenceRequestHandler` propagates boxes at a 10 Hz target.
- Source frame cache is bounded to four frames.
- Tracking requests are generation-guarded and cleared on stop/interruption.
- Low-confidence/missing tracks are dropped after six consecutive misses.
- This is a 2D box tracker seeded by cloud detections, not a local bottle detector, segmentation engine, or 3D surface reconstruction.

Browser:
- Samples a bounded 320 px grayscale crop at 10 Hz.
- Seeds up to nine textured patches within each cloud bottle box.
- Sparse patch matching estimates median motion and propagates the box between cloud reads.
- Confidence decays and tracks are discarded when correspondences disappear.
- Latest refinement seeds motion features from the exact cropped canvas sent to cloud recognition, reducing asynchronous seed drift.
- This is sparse patch motion, not a learned detector or full optical-flow implementation.

Shared state:
- Bottle metadata is retained on visual track IDs during local geometry updates.
- Cloud-seed vs local-propagation event sources are distinguished.
- Cloud misses no longer automatically erase valid native local tracks.
- Motion-track confidence and bottle-read confidence are separate.
- Metric ARKit depth and camera pose project accepted bottle boxes into world points.
- Spatial physical IDs are separate from product/catalog IDs.

Open acceptance tasks:
- Recorded-frame tests with adjacent bottles, identical SKUs, crossings, camera translation/rotation, scale change, partial/full occlusion, glare, low light and motion blur.
- Prove one-to-one assignment under simultaneous multi-object motion; nearest-neighbour world-point association is not a substitute for a held-out identity-switch test.
- Validate orientation/ray-basis mapping on actual iPhone portrait/landscape camera frames.
- Verify relocalization, reset and stale timestamp behavior on physical hardware.
- Profile sustained CPU, battery and thermal behavior.
- Do not describe the current point anchors as bottle meshes or reconstructed 3D surfaces.

## Stage 3 — Complete the visual tracking experience

**Disposition: mask-to-contour and neon overlay infrastructure is implemented and tested; no live segmentation producer supplies masks.**

Implemented:
- `src/live/maskContour.ts` extracts the largest external contour from real binary/probability mask pixels.
- Crop-local mask coordinates map into normalized camera coordinates.
- Malformed, empty and undersized masks are rejected.
- Confidence thresholds and point budgets are bounded.
- Contour geometry maps normalized polygons into camera-space line segments.
- `MaskContourOverlay` renders supplied real contour geometry in royal blue with glow.
- When a real mask is present, the provisional rectangle border is hidden.
- When only a box is available, it remains a subdued dashed-grey provisional detection; no fake silhouette is drawn.
- A previously measured contour can be warped with an existing tracked box between fresh segmentation passes. That transformation must never be described as a newly measured mask.

Validation:
- PR #32 head `8c4fc15`: TypeScript, 36 focused tests across seven files, web export, exported-app verification and iOS simulator compile passed.
- The subsequent browser-only `803f3bee` refinement passed browser validation.

Open task:
- Connect a real, licensed segmentation provider to the camera stream and attach its masks to persistent visual track IDs. Until then the royal-blue contour is infrastructure and will not appear from ordinary box-only cloud detections.

## Stage 4 — Integrate and benchmark beverage segmentation/recognition

**Disposition: research and contour plumbing are complete enough to begin an isolated model experiment; no model runtime or weights are integrated.**

Current experiment order:
1. D-FINE-seg-N COCO instance segmentation — first browser candidate by expected size.
2. D-FINE-seg-S — quality comparison.
3. MobileSAM — box-prompted mask-refinement comparison.
4. Apple Vision `VNGenerateForegroundInstanceMaskRequest` — separate native iOS foreground-mask experiment; generic foreground separation, not a bottle classifier.
5. EdgeSAM — keep the architectural integration option documented, but do not enable/distribute without written commercial permission for the exact code and weights.
6. Exclude AGPL-derived options unless a separately licensed implementation and checkpoint are verified.

Current research constraints:
- D-FINE-seg upstream documents Apache-2.0 code and COCO instance-segmentation checkpoints, ONNX and Core ML export, and per-instance mask outputs. Do not use its Cityscapes semantic-segmentation checkpoints for commercial deployment; those carry non-commercial dataset terms.
- ONNX Runtime Web documents WASM/CPU support on iOS Safari. WebGPU is not supported on iOS Safari; WebGL is supported but in maintenance mode.
- MobileSAM's browser ONNX implementation has compatibility/quality caveats; verify exact runtime versions rather than copying its old dependency choice.
- No model weights, runtime dependency, or segmentation checkpoint is currently bundled or enabled in Discover.

Benchmark gate:
- Use one held-out, hand-annotated camera set covering clear/green/amber/dark/frosted glass, wine shoulders and foil, wax, beer bottles/cans, growlers, overlapping stock, reflections, glare, low light, motion blur, partial occlusion, and similar vintages/SKUs.
- Measure mask IoU, boundary F-score, bottle precision/recall, false-positive rate, cold/warm first-mask latency, sustained refresh rate, peak memory, download size, battery and thermal behavior.
- Report desktop Chrome, iOS Safari/WASM, and native iOS/Core ML separately.
- Initial target (<500 ms to first useful mask after a trusted seed and >=10 Hz local propagation) is a target, not an achieved result.
- Keep cloud Claude label reading as product-identification source until a local beverage model is independently trained and validated. A generic COCO bottle class is not a full beverage/SKU reader.

Immediate next engineering task: run an isolated D-FINE-seg-N export/runtime compatibility and cold-start benchmark without adding it to the production dependency graph. Compare D-FINE-S and MobileSAM only after the N baseline is measured.

## Stage 5 — Backend, catalog identity and data integrity

**Disposition: DEV schema is ahead of its live reader and worker integration; this is a release blocker.**

Verified active DEV state:
- Project status: `ACTIVE_HEALTHY`.
- 39 recorded migrations, including the product-intelligence pipeline and sighting-to-product attach RPC.
- Active Edge Functions: `discover-retention`, `discover-api`, `discover-menu-read`, `discover-voice-session`, `discover-live-read`. No product-enrichment worker is deployed.
- Active cron jobs are retention and rate-limit cleanup only; neither drains product-enrichment jobs.
- Current counts: 285 legacy `product_index` rows; 1 `discover_products` row; 0 product attributes; 0 evidence rows; 0 packages; 2 enrichment jobs; 0 PHG export queue rows; 1 bottle sighting.
- Both enrichment jobs are queued, attempts 0, not locked, and have no last error.
- Internal product tables have RLS enabled and service-role-only table grants in the inspected grant query. `bottle_sightings` has authenticated SELECT restricted to `auth.uid() = consumer_id`; service role handles writes.

Critical identity mismatch:
- Active DEV `discover-live-read` is deployment v13 / source VERSION `0.3.6`.
- Its frame and save paths still synthesize missing brand/product field-confidence values from overall frame confidence.
- It still assigns a product match using brand equality plus fuzzy score >= 0.72; product expression is not required to match exactly.
- It does not withhold catalog matching when unmodeled SKU differentiators (vintage, size, barcode/SKU, batch/lot, proof) are present.
- Draft PR #28 contains the conservative identity correction, but it is not merged or deployed.
- The database's `discover_attach_sighting_to_product(uuid)` RPC independently uses a local fuzzy product-index match at >=0.88 and does not enforce the same complete-label / SKU-differentiator policy. Reconcile this path too; fixing only the Edge Function will leave a second catalog-attachment path inconsistent.
- Active `discover-live-read` save inserts `bottle_sightings` but does not call the attach RPC. No relevant table trigger was found. Therefore the new product-intelligence queue is not connected to live saves.
- No deployed worker or cron drains the two queued enrichment jobs.

Tracked action:
- [Issue #34 — Complete Discover product-intelligence queue and live-reader integration](https://github.com/robsloma-sudo/Harmony-Discover/issues/34)
- [PR #28 — Conservative product identity aggregation](https://github.com/robsloma-sudo/Harmony-Discover/pull/28)

Required:
- Reconcile all catalog-identity entry points: frame response, save, attach RPC, enrichment, and any future aggregation.
- Keep physical bottle identity distinct from product/SKU identity.
- Implement an idempotent queue worker with bounded concurrency, row locking, retry/backoff, terminal/dead-letter state, timeouts, cost caps, and source/evidence validation.
- Define the explicit sighting -> product attach step.
- Keep PHG export staging and manual review only. Discover must not write directly to Harmony production.
- Add privacy/consent/export/delete coverage for the new tables and verify all policies/grants table by table.
- No blanket RLS policy creation: current advisor warnings include internal tables whose grants are service-role-only; verify actual exposure before changing permissions.

## Stage 6 — Performance, testing, security and observability

**Disposition: useful automated coverage exists; release-grade test evidence is incomplete.**

Confirmed:
- Browser CI passed on `18bedcd`: TypeScript, 32 focused tests across six files, web export and exported-app verification.
- Browser CI passed on `8c4fc15`: TypeScript, 36 focused tests across seven files, web export and exported-app verification.
- Latest browser-only commit `803f3bee` was reported green.
- Native iOS simulator compile passed at `8c4fc15`.
- Scanner validation workflow currently runs seven selected test files; it does not run the entire Vitest suite or Edge Function integration tests.
- No physical iPhone/Safari runtime test has been reported.
- No model benchmark has been run.
- No sustained thermal/memory/battery results exist.

Additional release tests:
- End-to-end camera -> cloud read -> Vision/OCR/barcode -> local tracking -> contour -> save -> sighting -> product attach -> enrichment -> reviewed PHG staging.
- Replay captured frame sequences deterministically.
- Concurrency, duplicate requests, stale response, app backgrounding, interrupted upload, retry and rate-limit tests.
- Verify privacy-safe logs do not include image bytes, labels, or user identifiers.
- Verify token/cost caps and global quota lock behavior under concurrent clients.
- Verify no user/anon client can directly write internal product tables or export queue.
- Add queue-age, failure, retry and cost observability.

## Stage 7 — Release and deployment

**Disposition: not release-cleared.**

- PR #32 remains draft and unmerged; its target is a feature branch, not `main`.
- PR #28 remains draft and unmerged.
- No production deployment, Netlify deployment, Harmony production mutation, or PHG export was performed in this audit.
- No real-device acceptance, end-to-end product pipeline acceptance, or segmentation-model benchmark exists.
- Do not merge or deploy based solely on the green browser checks or simulator compile.

Release sequence:
1. Finish identity-policy reconciliation and queue-worker design in DEV.
2. Complete D-FINE-seg-N benchmark and compare alternatives.
3. Pass recorded-frame and physical iPhone/Safari acceptance.
4. Pass full regression, Edge Function tests, security review, privacy checks, cost limits and rollback rehearsal.
5. Reconcile all PRs against the current `main` head and resolve overlap.
6. Only after explicit owner approval, prepare the production release and Netlify deployment.

## Resume point

The last scanner-specific work on PR #32 refined browser motion seeding to use the exact cropped frame submitted to cloud recognition (`803f3bee`). Browser validation was reported green. The contour pipeline is ready to receive a real mask provider, but no provider is active.

**Resume Stage 4 with an isolated D-FINE-seg-N benchmark. In parallel, treat Stage 5 identity/queue integration as a production blocker and work through Issue #34 / PR #28 in DEV-only source branches. Do not merge, deploy, run migrations, or write to Harmony production without explicit approval.**
