# Iteration 28 — Web homepage and Netlify routing isolation

## Why
The `/index.html` test returned Expo Router's Unmatched Route screen. The native root route (`app/index.tsx`) imports the camera screen and camera permission hook directly. This couples browser startup to native camera initialization.

## Changes
- Added `app/index.web.tsx`, a browser-specific root route that avoids native camera imports and provides navigation to existing app sections.
- Kept `app/index.tsx` unchanged for iOS and Android.
- Declared Expo web bundling explicitly as Metro with static output in `app.json`.
- Added `netlify.toml` to build from source using Expo web export and publish `dist`.

## Verification status
- Source/config changes are staged.
- Dependency install and Expo export have NOT completed in this environment; prior npm installs timed out.
- This is NOT a verified deploy-ready `dist` package. Do not upload this source ZIP with Netlify Drop.
- Build via Netlify's connected Git source, or run the documented build locally and upload the generated `dist` folder.
- No Supabase functions, database, secrets, or production Harmony resources were changed.
