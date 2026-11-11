# iOS ARKit capability probe

**Scope:** Harmony Discover DEV only. This is the first native milestone, not a live scanner.

## What is implemented

- A local Expo native module named `DiscoverARKit`.
- Runtime checks for ARKit world tracking, scene depth, smoothed scene depth and mesh reconstruction.
- Device OS and hardware identifier reporting for an auditable test matrix.
- An explicit `liDARAssumed: false` field. No hardware capability is inferred from the iPhone marketing name.
- A TypeScript wrapper that returns `null` on non-iOS or when the native development build does not contain the module.

## Important limitations

- The probe does not start an AR session, access camera frames, detect a bottle, draw overlays, or save a digital twin.
- Expo Go / web preview cannot load this custom native module. Test using an iOS development build generated after native prebuild.
- Capability booleans report platform API support; actual session tracking quality must be tested at runtime in the next milestone.

## Test procedure

1. Run `npm run prebuild:ios`.
2. Build/install the development client with `npm run build:dev:ios`.
3. Call `getDiscoverARKitCapabilities()` from a temporary diagnostics screen or native integration test.
4. Record the exact `machineIdentifier`, iOS version and four capability booleans.
5. Verify the returned `liDARAssumed` value is always false.
6. Do not enable the 3D Live Bottle mode until a subsequent AR-session prototype proves stable tracking and visible tracking-loss behavior.

## Safety boundaries

No Supabase schema changes, storage uploads, production writes, Core/Journeys changes or deployment are part of this probe.
