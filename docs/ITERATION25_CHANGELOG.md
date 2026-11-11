# Iteration 25 — Durable correction DEV rollout

Date: 10 Nov 2026

## Completed
- Verified the correction field names and category enum against the live Discover DEV schema.
- Applied `0010_observation_item_corrections.sql` to Discover DEV only.
- Deployed `discover-api` v4 to Discover DEV only, preserving the v3 environment guard, auth verification, rate limiting, and all existing routes.
- Added authenticated `PUT /v1/observations/{observationId}/items/{itemId}` using the atomic owner-checked RPC and append-only before/after audit.
- Connected the preview screen's Save correction action to the API. Success and failure states are explicit.
- Retrieved active v4 after deployment and confirmed the route and RPC handler are present.
- Verified the RPC ACL: anon=false, authenticated=false, service_role=true.

## Not yet proven
- No authenticated real scan/correction test has been run; DEV has no test observation yet.
- Anthropic key validity and real image-read compatibility remain unverified.
- Expo dependencies were not installed successfully in the prior session, so TypeScript/build checks remain outstanding.
- Netlify has not been deployed or changed.

## Environment boundary
- DEV project: `lqqmwqrffelgnbngrkep`
- Harmony production: `lqjtwabzmgjcufftuqvu` — untouched and read-only.
- No cross-system data sharing was enabled.


## Follow-up: Iteration 26 Netlify build diagnosis
- Added the missing Expo web runtime dependencies (`react-native-web` and `react-dom`).
- Added `build:web` script for the Netlify Expo web export.
- See `ITERATION26_NETLIFY_WEB_BUILD_FIX.md`.
- Source-only change; no Netlify deployment or backend changes.

## Iteration 27 — Netlify Expo Router dependency
- Added explicit root dependency `query-string: ^7.1.3` after the 2026-11-10 Netlify log showed Metro could not resolve `query-string` from Expo Router's `getPathFromState.js`.
- Retained Iteration 26 web dependencies and `build:web` script.
- Source-only; no install, export, or deployment performed.
