# Native scanner model evaluation — D-FINE segmentation

## Scope

This is a research-only evaluation of the repository-pinned `public/models/dfine_seg_n_coco.onnx` graph. It does not add an inference dependency to the app, change scanner runtime behavior, modify Supabase, or deploy production.

## Model contract

- Input: `[1, 3, 640, 640]`, float32
- Outputs: labels `[1, 300]`, boxes `[1, 300, 4]`, scores `[1, 300]`, masks `[1, 300, 160, 160]`
- Graph: ONNX IR 10, opset 19, 822 nodes, 441 initializers, no custom operator domains
- Downloaded model SHA-256 observed in CI: `999b6ae8970461b9a2b4a50f6cf07df3f355b131698a3e5b56cd420fbea5de30`

## Initial Apple Silicon macOS benchmark

Successful CI run: [CoreML probe run 43459855285](https://github.com/robsloma-sudo/Harmony-Discover/actions/runs/43459855285).

The run used ONNX Runtime 1.32.0, a deterministic random float32 input of shape `[1,3,640,640]`, five warm-up inferences, and 25 timed inferences per provider.

| Metric | CPU only | CoreML + CPU fallback |
|---|---:|---:|
| Session load | 76.82 ms | 2,132.12 ms |
| First inference | 445.68 ms | 273.94 ms |
| Warm p50 | 399.79 ms | 185.25 ms |
| Warm p95 | 474.77 ms | 212.39 ms |
| Warm min / max | 293.69 / 498.75 ms | 133.73 / 230.04 ms |

The CoreML configuration was approximately 2.16x faster at warm p50 on this macOS runner. The CoreML session partitioned 155 node events to CoreML and 465 to CPU. This is a mixed-provider execution, not full graph offload.

Labels matched exactly. The maximum absolute deltas observed were 0.002197 for boxes, 0.00000323 for scores, and 0.759165 for masks. The large mask delta means mask parity is not established; the updated CI now reports mean/p99 deltas and positive-logit agreement so this can be evaluated more usefully.

## iOS runtime integration feasibility

Official ONNX Runtime documentation confirms that the `onnxruntime-objc` CocoaPod for iOS includes CPU and CoreML support, and that its Objective-C API is callable from Swift through a bridging header. The Objective-C API exposes CoreML provider options and session execution.

Relevant official references:
- https://onnxruntime.ai/docs/get-started/with-obj-c.html
- https://onnxruntime.ai/docs/api/objectivec/Classes/ORTSessionOptions.html
- https://onnxruntime.ai/docs/api/objectivec/Classes/ORTCoreMLExecutionProviderOptions.html
- https://onnxruntime.ai/docs/api/objectivec/Classes/ORTSession.html
- https://onnxruntime.ai/docs/api/objectivec/Classes/ORTValue.html

The documented Swift surface includes:
- `ORTSessionOptions.appendCoreMLExecutionProvider(with:)`
- `ORTCoreMLExecutionProviderOptions.createMLProgram`
- `ORTCoreMLExecutionProviderOptions.onlyAllowStaticInputShapes`
- `ORTSession(env:modelPath:sessionOptions:)`
- `ORTSession.run(withInputs:outputNames:runOptions:)`

This means the next native proof of concept should use the official iOS CocoaPod with CoreML enabled rather than attempting an unsupported ONNX-to-CoreML conversion. The existing macOS benchmark already shows that this provider can execute this graph, with a mixed CoreML/CPU partition.

Implementation constraints:
1. Keep session creation on a background queue and cache exactly one reusable session; the measured macOS cold initialization was about 2.13 seconds.
2. Keep camera pixel-buffer conversion, resize/letterbox, normalization, and channel ordering explicit and covered by tests. The model expects NCHW float32 [1,3,640,640].
3. Request the outputs by their actual names: labels, boxes, scores, masks. Confirm output tensor types and shapes at runtime rather than assuming them.
4. Preserve CPU fallback. Do not require ANE-only execution until device compatibility and fallback behavior are measured.
5. Confirm how the CocoaPod's headers are imported into this Expo Swift module. The official docs describe a bridging header; if the generated Expo iOS project makes that awkward, add a small Objective-C shim inside the module rather than changing app-wide build settings blindly.
6. Do not add the dependency or model to the production app in this research PR. First create a separate native spike branch, verify CocoaPods resolution and iOS simulator compilation, then test on physical iPhone hardware.

## Engineering interpretation

1. CoreML is a promising execution path for this graph, but the 2.13-second session creation cost means the model must be initialized off the camera-critical path and reused. Recreating the session per frame is unacceptable.
2. The warm p50 is still about 185 ms on this macOS benchmark, far below a 10 Hz target. We should not assume the current graph is suitable for continuous full-resolution inference on iPhone.
3. The sensible scanner architecture is sparse local detection plus lightweight tracking between detector passes. The existing native Vision tracking work can bridge detections after a valid seed, but it does not solve first-frame detection.
4. Do not trust mask geometry for bottle outlines until parity and real-image quality are validated.
5. This random-input benchmark measures runtime and provider partitioning only. It says nothing about bottle recall, false positives, label localization, or segmentation quality on real bar scenes.

## Required next validation

- Re-run the pinned-model checksum and CoreML benchmark with the added mask parity metrics.
- Test representative real bottle/bar images through CPU and CoreML, comparing class, confidence, boxes, and masks.
- Evaluate model conversion/packaging options for direct Core ML deployment, including cold-start and memory costs.
- Measure on actual supported iPhones: first-frame latency, warm latency, sustained FPS, memory, thermals, and camera concurrency.
- Keep the inference implementation research-only until the device and visual-quality gates pass.
