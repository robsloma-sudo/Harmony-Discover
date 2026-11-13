# Native D-FINE iOS CoreML session spike

## Scope

This branch is an isolated proof of native runtime linkage and model-session initialization. It does not connect inference to ARKit frames and does not change the camera viewfinder behavior.

## Implementation

- Local Expo module podspec pins `onnxruntime-objc` to 1.32.0.
- A module-local Objective-C++ shim owns ONNX Runtime types and exposes a small API to the Swift Expo module.
- Swift verifies the pinned D-FINE model SHA-256 before handing the file path to the shim.
- The shim creates one ORT environment and one ORT session, registers CoreML before CPU fallback, validates the input/output names, and retains the session for reuse.
- CoreML is configured with MLProgram, all compute units, static input shapes, and a persistent `ModelCacheDirectory`.
- The explicit Expo methods `downloadAndInitializeDfineNativeRuntime()` and `runDfineNativeSmokeTest()` are not called by the existing scanner. They are only for a deliberate device test.

## Why cache and reuse matter

The latest successful Apple Silicon macOS benchmark showed a 3.16-second CoreML session initialization and 291.57 ms warm p50. An earlier run showed 2.13 seconds and 185.25 ms respectively. This variance makes cold-start and caching behavior first-class acceptance criteria. Session creation must stay off the camera callback queue; the camera must never wait for model initialization.

## Model contract enforced

- SHA-256: `999b6ae8970461b9a2b4a50f6cf07df3f355b131698a3e5b56cd420fbea5de30`
- Input: `input`, float32, [1, 3, 640, 640]
- Outputs: `labels`, `boxes`, `scores`, `masks`

## Known integration risk

A public ONNX Runtime issue reports that `onnxruntime-objc` headers can trigger an Xcode 26.3 framework-header warning that was associated with `ORTEnv` runtime crashes on iPhone 17 / iOS 26.x. The issue was closed by an inactivity bot rather than a verified upstream fix. If our build emits `CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER` warnings for the ORT pod, do not accept a compile-only pass as runtime proof. Reproduce on a physical device and evaluate the documented Podfile workaround or switch the shim to the C API package if needed.

Reference: https://github.com/microsoft/onnxruntime/issues/27717

## Acceptance gates

1. CocoaPods resolves the pinned package and the native iOS simulator build compiles.
2. On a physical iPhone, call the explicit download/initialize method and confirm the output names and provider registration.
3. Run the synthetic smoke test and confirm the four expected output shapes.
4. Repeat initialization and confirm the same session is reused.
5. Measure cold initialization with and without CoreML model cache, warm inference, memory, and thermals.
6. Run deterministic and real bar-scene frames through native inference; compare output shapes, scores, boxes, and thresholded masks to the validated web/CPU path.
7. Only after those gates pass, connect sparse detection to the existing native Vision tracking seeds.

## Safety

This PR does not merge, deploy, alter production Netlify, touch Supabase, or change the main Harmony/PHG data. Production deployment is expected to remain skipped for pull requests.
