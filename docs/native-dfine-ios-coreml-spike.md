# Native D-FINE iOS CoreML session spike

## Scope

This branch is an isolated proof of native runtime linkage and model-session initialization. It does not connect inference to ARKit frames and does not change the camera viewfinder behavior.

## Implementation

- Local Expo module podspec pins the published `onnxruntime-objc` CocoaPod to 1.24.3. (The separate macOS benchmark uses the Python runtime 1.32.0.)
- A module-local Objective-C++ shim owns ONNX Runtime types and exposes a small API to the Swift Expo module.
- Swift verifies the pinned D-FINE model SHA-256 before handing the file path to the shim. If an existing cached model fails the checksum, the app removes that invalid cache file and downloads the pinned asset again.
- The shim creates one ORT environment and one ORT session, registers CoreML before CPU fallback, validates the input/output names, and retains the session for reuse.
- CoreML is configured with MLProgram, all compute units, static input shapes, and a persistent `ModelCacheDirectory`.
- A local Expo config plugin patches the generated Podfile so the `onnxruntime-objc` target sets `CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER = NO`. The plugin fails fast if the target or Podfile hook is missing, and the iOS CI job verifies the generated setting.
- The explicit Expo methods `downloadAndInitializeDfineNativeRuntime()` and `runDfineNativeSmokeTest()` are not called by the existing scanner. They are available from the `/arkit-live-test` diagnostics route on iOS for a deliberate device test.

## Why cache and reuse matter

The latest successful Apple Silicon macOS benchmark showed a 3.16-second CoreML session initialization and 291.57 ms warm p50. An earlier run showed 2.13 seconds and 185.25 ms respectively. This variance makes cold-start and caching behavior first-class acceptance criteria. Session creation must stay off the camera callback queue; the camera must never wait for model initialization.

## Model contract enforced

- SHA-256: `999b6ae8970461b9a2b4a50f6cf07df3f355b131698a3e5b56cd420fbea5de30`
- Input: `input`, float32, [1, 3, 640, 640]
- Outputs: `labels`, `boxes`, `scores`, `masks`

## Known integration risk

A public ONNX Runtime issue reports that `onnxruntime-objc` headers can trigger an Xcode 26.3 framework-header warning associated with `ORTEnv` runtime crashes on iPhone 17 / iOS 26.x. The issue was closed by an inactivity bot rather than a verified upstream fix. This branch applies the documented Podfile workaround specifically to the `onnxruntime-objc` target and runs simulator compilation with Xcode 26.3. A compile pass still does not prove the runtime workaround on a physical device; the `ORTEnv` initialization and inference smoke test must be run on an iPhone.

Reference: https://github.com/microsoft/onnxruntime/issues/27717

## Acceptance gates

1. CocoaPods resolves the pinned package, the generated Podfile contains the target-specific header workaround, and the native iOS simulator build compiles with Xcode 26.3.
2. On a physical iPhone, call the explicit download/initialize method and confirm the output names and provider registration.
3. Run the synthetic smoke test and confirm the four expected output shapes.
4. Repeat initialization and confirm the same session is reused.
5. Measure cold initialization with and without CoreML model cache, warm inference, memory, and thermals.
6. Run deterministic and real bar-scene frames through native inference; compare output shapes, scores, boxes, and thresholded masks to the validated web/CPU path.
7. Only after those gates pass, connect sparse detection to the existing native Vision tracking seeds.

## Safety

This PR does not merge, deploy, alter production Netlify, touch Supabase, or change the main Harmony/PHG data. Production deployment is expected to remain skipped for pull requests.
