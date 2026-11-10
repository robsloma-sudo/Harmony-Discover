# Durable menu transcription corrections — Iteration 24

## Included in this source package
- DEV-only migration `0010_observation_item_corrections.sql` adds an append-only before/after correction audit table.
- The SQL function `discover_correct_observation_item` validates ownership, whitelisted fields and lengths, updates the item and writes its audit row in one transaction.
- Canonical Edge API source now includes `PUT /v1/observations/{observationId}/items/{itemId}`. It uses the authenticated subject derived by the existing API identity middleware.
- `saveMenuItemCorrection` provides the typed mobile client helper.

## Security model
The client never writes directly to `observation_items` or the audit table. The API derives the subject from a verified Supabase bearer token. The database function checks that the subject owns both the observation and item. RPC execution is revoked from `public`, `anon`, and `authenticated`, and granted only to `service_role`. The audit table has RLS enabled and no anon/authenticated grants.

## Deployment status: NOT DEPLOYED
This is source preparation only. No migration has been applied and no Edge Function has been deployed. Do not connect the UI save button until the migration and API route are deployed and tested.

## Required rollout and verification
1. Review and apply migration `0010_observation_item_corrections.sql` to Discover DEV project `lqqmwqrffelgnbngrkep` only.
2. Rebuild the generated Edge Function from canonical source using the project build process. The checked-in source is under `apps/api/src/core/observations.ts` and `apps/edge/router.ts`.
3. Deploy `discover-api` to Discover DEV only.
4. Test: valid owner correction; non-owner observation/item rejection; invalid/unknown field rejection; clearing nullable fields; max lengths; audit before/after values; repeated save behavior.
5. Only after successful tests, wire review UI save and show a success state after the server confirms persistence.

## Important implementation note
The Iteration 22 review screen still edits local component state and explicitly tells users those edits are not saved. Iteration 24 does not change that truthful UI message. The API helper is ready, but the server route is not live yet.

## DEV rollout update — 10 Nov 2026

- Applied the additive migration to Discover DEV project `lqqmwqrffelgnbngrkep`.
- Deployed `discover-api` version 4 to that same DEV project. The deployment was assembled from the complete active version 3 function bundle retrieved from Supabase, then extended with the correction handler and `PUT /v1/observations/{observationId}/items/{itemId}` route. `verify_jwt` remains false at the gateway because the handler independently validates the bearer token with Supabase Auth.
- Post-deploy retrieval confirms the new route and RPC handler are present in active version 4.
- Database verification confirms the audit table exists; `anon` and `authenticated` cannot execute the correction RPC; `service_role` can.
- The mobile preview now calls the correction endpoint when Save correction is tapped. A successful response replaces the local item and displays a saved confirmation; failures leave the user's edits visible and report that they were not saved.
- No real authenticated scan/correction has been exercised yet because DEV currently has no test observation. End-to-end proof still requires a signed-in test account and one real menu scan.
- Security advisor output includes an INFO finding for RLS-enabled tables with no policies, including the new audit table. This is intentional for the audit table: direct anon/authenticated access is revoked and writes happen only through the service-role RPC. Existing unrelated INFO findings remain. A separate WARN reports leaked-password protection disabled in Auth; it was not changed in this rollout.
- Harmony production project `lqjtwabzmgjcufftuqvu` was not queried for writes, changed, or deployed to. Netlify was not changed.
