# Liquid-level analysis (experimental)

## Runtime architecture

- The web camera path submits the same downsampled `ImageData` already used by local segmentation to a dedicated Web Worker after segmentation has completed.
- The web queue is single-flight, retains at most the newest pending frame, limits each job to four bottle tracks, and discards stale frames/results. It never falls back to pixel analysis on the UI thread.
- The native iOS path sends the already captured ARKit JPEG and normalized bottle boxes to `DiscoverARKit.analyzeLiquidLevels`. The native module decodes and analyzes the image on a utility queue. The scanner publishes bottle boxes before liquid analysis returns; fill data is a later enrichment.
- Liquid analysis does not call the cloud bottle reader and does not change Anthropic routing.
- Calibration profiles are stored locally with AsyncStorage. No Supabase table or PHG Core data is used.

## Evidence gates

A fill-height result requires all of the following:

1. The crop has usable optical signal. Severe clipped glare, near-black imagery, and flat/low-contrast crops are rejected.
2. A horizontal transition is supported across at least five of seven interior columns. Partial hand/label obstruction that hides more than two sampled columns is rejected.
3. Textured label bands are masked; both web and native detectors require five of seven columns. Irregular interfaces are rejected.
4. Three distinct high-confidence observations agree within the temporal spread threshold.
5. The result remains attached to a currently tracked bottle.

The label-texture and multi-column tests are conservative heuristics, not a semantic hand detector. A hand, reflective glass, tinted liquid, or label that cannot be separated reliably must result in no estimate rather than a guessed line. Opaque bottles may be unobservable.

## Bottle volume calibration

Fill height is not volume. Milliliters/fluid ounces are shown only when:

- the label read is catalog matched with match score at least 0.90;
- the calibration profile matches that catalog identity and package size; and
- the measured height is within the profile's calibrated range.

In Live Inventory, open **Bottle-shape calibration** on a verified product. Measure known volumes with a scale or graduated measure. For each sample, record the current live fill-height percentage relative to the detected bottle bounding box as a fraction (52% becomes `0.52`) and the actual measured milliliters. Use the same camera framing and viewfinder box for the calibration run. Include `0:0` for empty and a full-capacity point at the real full-fill line; that height can be below 1. Samples must have strictly increasing measured volume as height rises; flat or decreasing segments are invalid. Do not assume a cylinder or invent sample points. Profiles remain local to the device.

## On-device performance check

The Live Inventory diagnostics line reports worker availability, completed jobs, worker processing time, local segmentation time, total local-frame time, skipped jobs, and errors.

For a meaningful iPhone comparison:

1. Use the same device, camera, lighting, backbar scene, and bottle arrangement.
2. Record a 60-second baseline with liquid analysis disabled, then a 60-second run with it enabled.
3. Compare median and 95th-percentile local-frame time, time to first bottle box, time to confirmed product identity, dropped frames, battery change, and device temperature.
4. Repeat with one, four, and eight visible bottles; both web and native background analysis are capped at four bottle tracks per frame.
5. Test clear, green, amber, dark, and opaque glass; front/back lighting; glare; labels crossing the liquid line; and a hand covering part of the bottle.

Do not call the feature performance-safe based on desktop timing alone. Physical iPhone Safari and native-app measurements are still required before production rollout.

## Current acceptance boundary

This implementation is experimental. Synthetic tests cover the detector, optics gate, queue policy, calibration curve, and profile storage. They do not establish real-backbar accuracy. Keep the PR unmerged and the production site unchanged until current TypeScript/tests/build and iOS simulator checks pass, followed by physical-device validation.
