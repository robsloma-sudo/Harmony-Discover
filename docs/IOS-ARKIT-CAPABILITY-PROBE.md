# iOS ARKit capability probe

**Scope:** Harmony Discover DEV only. This now includes a live ARKit world-tracking diagnostic surface, but it is not yet a bottle scanner.

## What is implemented

- A local Expo native module named `DiscoverARKit`.
- Runtime checks for ARKit world tracking, scene depth, smoothed scene depth and mesh reconstruction.
- Device OS and hardware identifier reporting for an auditable test matrix.
- An explicit `liDARAssumed: false` field. No hardware capability is inferred from the iPhone marketing name.
- A TypeScript wrapper that returns `null` on non-iOS or when the native development build does not contain the module.
- A native `ARSCNView` surface that starts/stops an ARKit world-tracking session and reports normal, limited, unavailable, interrupted and paused states.
- Throttled on-device Vision rectangle proposals (up to 4 analysis requests per second), with blue candidate outlines and frame skipping when analysis is busy.
- Candidate outlines are cleared when AR tracking degrades, so the UI does not leave stale geometry on screen.
- An isolated `/arkit-live-test` screen linked from ARKit diagnostics. It requires camera permission and gives the user an explicit start/pause control.
- Scene-depth semantics are enabled only when the runtime API reports support and the iOS 14 availability guard is met.

## Important limitations

- The live test displays the AR camera feed and ARKit session state only. It does not detect a bottle, draw bottle contours, map label geometry, run OCR, record/upload video, or save a digital twin.
- Tracking state is not equivalent to object tracking. A normal ARKit pose does not prove that a particular bottle is anchored or measured.
- Expo Go / web preview cannot load this custom native module. Test using an iOS development build generated after native prebuild.
- Capability booleans report platform API support; actual session tracking quality must be tested at runtime in the next milestone.

## Test procedure

1. Run `npm run prebuild:ios`.
2. Build/install the development client with `npm run build:dev:ios`.
3. Open Settings → ARKit diagnostics and record the exact `machineIdentifier`, iOS version and four capability booleans.
4. Open the live AR tracking test, grant camera permission, and start the session.
5. Test normal tracking, slow movement, fast movement, low-texture scenes, interruption, pause and resume.
6. Verify that tracking loss and recovery are surfaced to the UI and that pausing stops the AR session.
7. Verify the returned `liDARAssumed` value is always false.
8. Do not enable 3D Live Bottle mode until bottle-specific anchoring, contour accuracy, reacquisition and performance are separately validated.

## Safety boundaries

No Supabase schema changes, storage uploads, production writes, Core/Journeys changes or deployment are part of this probe.
