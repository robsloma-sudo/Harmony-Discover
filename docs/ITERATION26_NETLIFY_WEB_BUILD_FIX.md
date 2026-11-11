# Iteration 26 — Netlify web build dependency fix

## Failure observed
The supplied Netlify recording shows Expo attempting `expo export -p web` and failing because
`react-native-web@~0.19.13` is not installed. Netlify explicitly recommends installing it.
The build is configured to publish `dist`; deployment, cleanup, and post-processing are skipped.

## Source changes
- Added `react-native-web: ~0.19.13` to root dependencies.
- Added `react-dom: 18.3.1`, matching this project's React 18.3.1 runtime.
- Added `build:web` script: `expo export --platform web`.
- Kept web support enabled. Do not remove `web` from Expo platforms for a Netlify-hosted web app.

## Netlify settings
- Build command: `npm run build:web` (or keep the equivalent `npx expo export -p web`).
- Publish directory: `dist`.

Netlify should install dependencies from the updated package.json before running the build.
This source workspace does not contain a lockfile, so do not switch the Netlify command to
`npm ci` until a matching package-lock.json is generated and included.

## Validation status
- Static package/config review: completed.
- Dependency installation: not completed in this environment.
- Expo web export: not run.
- Netlify deployment: not performed.
- Production Harmony and Discover DEV backend: untouched by this frontend source patch.

## Next verification
Update the Netlify build source with these package.json changes and redeploy using the normal
workflow. Confirm the build gets past dependency validation and produces `dist`. If it reveals a
new error, diagnose that separately.
