# Discover DEV backend verification — 10 November 2026

## Scope

Read-only inspection of Supabase project `lqqmwqrffelgnbngrkep`. No database writes, schema changes, Edge Function deployments, Auth changes, or Netlify deployments were performed during this verification. Harmony production project `lqjtwabzmgjcufftuqvu` was not accessed or modified.

## Confirmed deployed functions

| Function | Version | State | JWT gateway |
|---|---:|---|---|
| `discover-api` | 6 | ACTIVE | `verify_jwt=false`; current v6 handler independently verifies the Supabase bearer token with `auth.getUser()` |
| `discover-menu-read` | 3 | ACTIVE | `verify_jwt=true`; also verifies the user token and observation ownership |
| `discover-retention` | 1 | ACTIVE | `verify_jwt=false` |

The API Edge Function has a fail-closed environment guard. It requires `DISCOVER_ENV=development`, an explicit allow-list containing only the Discover DEV project ref, and rejects any environment value containing the Harmony production project ref. The deployed entrypoint constructs the allow-list with `lqqmwqrffelgnbngrkep` and the runtime environment.

## Observation API contract

The deployed `discover-api` v3 source confirms these routes:

- `POST /v1/observations`: strict body includes `processingNoticeVersion`, optional `venueName`, optional ISO `capturedAt`, and `source` (`camera` or `gallery`). Returns `{ id, status }`.
- `POST /v1/observations/{id}/assets`: multipart field name is `file`.
- `POST /v1/observations/{id}/complete`: moves the observation from `created` to `received` and enqueues validation.
- `POST /v1/observations/{id}/read`: forwards the bearer token to `discover-menu-read`.
- `GET /v1/observations/{id}`: calls `discover_observation_result` with both authenticated subject ID and observation ID.

The Iteration 21/22 client sends the correct creation fields and multipart field name.

## Result contract verified against database function

`public.discover_observation_result(p_subject uuid, p_observation uuid)` returns `jsonb` with:

- `id`, `status`, `pages`, `venue_name_read`, `read_at`
- `quality.all_pages_complete`, `quality.min_confidence`
- `items[]` with `id`, `page`, `section`, `name`, `description`, `price`, `category`, `listed_ingredients`, `evidence`, and `text_verified`

This matches the `ObservationResult` and `DiscoveredMenuItem` types in `src/services/discoverObservationApi.ts`.

The function is `SECURITY DEFINER`, has a fixed `search_path` (`public, pg_temp`), checks `consumer_id = p_subject` in its query, and its observed ACL grants execute to `postgres` and `service_role`, not `anon` or `authenticated`. The API invokes it server-side after deriving the subject from a verified bearer token.

## Storage and row security

- `observation-assets` exists and is private (`public=false`).
- Bucket maximum file size is 15 MiB.
- Allowed MIME types are JPEG, PNG, WebP, and HEIC.
- RLS is enabled on the inspected observation, asset, extraction, and item tables.
- Policies observed for `menu_observations`, `observation_assets`, and `observation_items` permit authenticated users to read only rows where `auth.uid() = consumer_id`.
- The API's service-role credential is server-side only; the Expo client uses a publishable key and user session token.

## Reader behavior and unresolved verification

The reader v3:

- Confirms the request is running in the exact Discover DEV project.
- Requires `ANTHROPIC_API_KEY` and server-side service-role configuration.
- Verifies the user token and observation ownership.
- Creates short-lived signed URLs for private menu images.
- Sends images to Anthropic using an image `source.type = "url"` content block.
- Saves item rows before marking extraction `extracted`, so item persistence failure remains retryable.
- Marks the observation `ready_for_review` only when all assets are successfully handled; otherwise it returns HTTP 207 and leaves status `processing`.

Not verified: secret presence/validity, Anthropic's acceptance of this image URL block in a live request, actual image processing, or real-device upload behavior. The DEV database currently reports zero menu observation rows, so no prior real scan is available as a test fixture.

## Review UI state

Iteration 22 includes inline editing for item name, section, description, and printed price. Those corrections are local screen state only. They are not saved to the database. There is no correction endpoint or audit table wired into the deployed API. Do not label those changes as saved or durable.

## Next safe implementation step

Design and review an authenticated, owner-scoped correction endpoint and append-only correction audit record before deploying it to Discover DEV. Validate allowed fields, lengths, item/observation ownership, and retry/idempotency behavior. Do not expose direct client writes to `observation_items` and do not add any Harmony production connection.

## Deployment status

Iteration 22 is an editable source package only. No Netlify deployment was performed. Dependency installation, TypeScript typecheck, Expo build, and iPhone end-to-end testing remain outstanding.

## Follow-up read-only audit — 10 November 2026, 20:56 UTC

A fresh read-only inspection supersedes any older function-version statements above:
- `discover-api`: ACTIVE v6, `verify_jwt=false`; the deployed v6 entrypoint creates a server-side service-role client only after a fail-closed Discover DEV environment check. Its identity adapter validates the bearer token with Supabase Auth.
- `discover-menu-read`: ACTIVE v3, `verify_jwt=true`; the deployed source still sets wildcard CORS (`Access-Control-Allow-Origin: *`). It verifies the bearer token and checks observation ownership. Review and replace wildcard browser origins with an explicit allow-list before broader public exposure.
- `discover-api` v6's router also uses wildcard CORS, explicitly relying on bearer-token access rather than cookies. The request handler validates the bearer token before routing to user data. This is not the same as unauthenticated public data access, but exact origin allow-listing would reduce the browser attack surface and should be considered as a separate API compatibility change.
- `discover-retention`: ACTIVE v1, `verify_jwt=false`; inspect its cron-secret validation and deployment configuration before treating it as a hardened scheduled endpoint.

Fresh catalog inspection found 17 public base tables, all with RLS enabled. Six explicit policies are present: owner SELECT on `menu_observations`, `observation_assets`, and `observation_items`; owner SELECT/INSERT/UPDATE on `personal_taste_profiles`. The other 13 RLS-enabled tables have no policies, consistent with service-mediated access and default-deny RLS. Do not add broad client policies to clear the linter.

The Security Advisor reported:
- 13 informational `rls_enabled_no_policy` findings for the service-only tables listed in `docs/DEV_MIGRATION_RECONCILIATION_2026-11-10.md`.
- 1 warning: Auth leaked-password protection is disabled.

The Performance Advisor reported two missing covering indexes on `observation_item_corrections` foreign keys: `consumer_id` and `observation_id`. A source-only follow-up migration `20261110210000_observation_correction_fk_indexes.sql` has been added on the hardening branch. It has not been applied.

The Performance Advisor also reported 10 unused indexes. Since the DEV project is new and contains no meaningful observation/learning records, this is not sufficient evidence to drop them; retain until realistic workload data exists.

No database writes, migration application, Auth setting changes, Edge Function deployments, or production operations occurred during this follow-up.

## Retention scheduler verification — read-only

The live `cron.job` catalog contains two active schedules:
- `discover-retention-daily`: `17 9 * * *` UTC. The command references `vault.decrypted_secrets` for the function URL and cron header; no secret values were read. Its latest recorded run on 10 November 2026 at 09:17 UTC succeeded.
- `discover-rate-limit-sweep`: `47 9 * * *` UTC. It calls `public.discover_purge_rate_limits()`; its latest recorded run on 10 November 2026 at 09:47 UTC succeeded.

The deployed `discover-retention` v1 handler independently checks the supplied `x-discover-cron-secret` by calling `discover_check_cron_secret` with the service-role client. Catalog ACL inspection confirms this verifier and the sensitive retention/account functions are executable by `service_role`, not `anon` or `authenticated`. This is a positive control; the cron secret itself was never retrieved or displayed.

## Additional reader abuse-control gap

The deployed `discover-menu-read` v3 source is not present in the inspected repository source tree (GitHub code search found no matching source path). The `discover-api` router applies a per-user `observations` rate limit before proxying to the reader, but `discover-menu-read` is also independently addressable as a public Supabase Edge Function URL. Its current handler verifies the JWT and observation ownership but does not call `discover_rate_limit` itself before invoking Anthropic.

Therefore a signed-in user can bypass the API router's rate limit by calling the reader function directly with their own observation ID, potentially increasing paid model usage. This is an authenticated cost-abuse risk, not an unauthenticated data-read bypass. Add an independent per-user rate limit inside the reader handler (and keep the outer API limit as defense in depth), then test both direct and proxied paths. Recover the canonical reader source before patching; do not edit generated output only.

## Deletion and retention function review

Read-only inspection of deployed database function definitions and ACLs confirmed:
- `discover_check_cron_secret(text)` requires a supplied value of at least 32 characters and compares it to the Vault secret named `discover_cron_secret`. Execute permission is service-role-only.
- `discover_photos_due_for_deletion(...)` selects qualifying observations that have a later qualifying observation at the same venue or have reached the configured photo age cap. It returns original asset paths and normalized extraction paths.
- `discover_subject_storage_paths(uuid)` returns distinct original and normalized object paths for a subject's non-deleted assets.
- `discover_start_deletion(uuid)` records a deletion request using a subject hash rather than the raw subject ID.
- `discover_update_deletion(...)` updates the request status and completion metadata.
- `discover_delete_subject_data(uuid)` removes learning questions/events/consent, private taste profiles, and menu observations; observation-related records cascade from observations.
- The sensitive export, deletion, retention and rate-limit routines inspected are executable by `service_role`, not `anon` or `authenticated`.

The deployed account handler's intended order is: record deletion receipt → remove Storage objects → record storage removal → delete subject rows → delete Auth user → close receipt. A failure records a failed state for retry. This is a sound fail-visible pattern, but no end-to-end deletion was attempted because there are currently zero observation rows and no test account/fixture was authorized. Validate retries, already-missing Storage objects, auth deletion, and residual hashed audit-record retention in a dedicated DEV test fixture before launch.
