# Browser scanner performance targets

## Goals

- Local bottle detector: target 10 inference starts per second (100 ms cadence).
- Visual tracking/render updates: target 60 updates per second (16.67 ms display cadence).
- Cloud identity recognition: independent, quota-limited enrichment; it is not part of the 10 Hz detector budget.

## Current implementation changes

- The local detector scheduler now requests work every 100 ms.
- The segmentation runner minimum interval is 100 ms.
- The optical-flow loop now samples at display cadence rather than being throttled to 66 ms.
- Both inference and tracking remain guarded against overlapping work.

## Important measurement distinction

A 100 ms scheduler does not guarantee 10 completed inferences per second. The detector is single-flight; measured throughput is bounded by actual model inference latency, image preparation, device thermal state, and browser scheduling.

Likewise, requestAnimationFrame can schedule up to the display refresh rate, but a camera stream may deliver only 30 unique frames per second (or less). Reprocessing an unchanged camera frame is wasted work. A future optimization should use requestVideoFrameCallback where available to detect unique camera frames, while keeping overlay interpolation/rendering on requestAnimationFrame at 60 Hz.

## Required device benchmark

Record at least 30 seconds per device and report:
- detector completed inferences/sec, mean, median, p95 latency, and skipped/busy ticks;
- unique camera frames/sec;
- optical-flow compute mean and p95;
- overlay render/update FPS and dropped-frame percentage;
- CPU, memory, and thermal behavior;
- track drift and identity switches with one bottle, adjacent bottles, and camera motion.

Do not claim 10 Hz detection or 60 FPS tracking as achieved until those measurements confirm it on representative iPhones and desktop browsers.
