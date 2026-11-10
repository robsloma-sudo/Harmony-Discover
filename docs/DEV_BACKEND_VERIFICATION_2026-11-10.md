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

## Follow-up source recovery and CI findings — 10 November 2026, 21:03 UTC

### Menu reader source recovered

The live `discover-menu-read` v3 source was retrieved from the DEV Edge Function inventory. Its original repository file was absent from the source-import branch. A clearly labeled reconstructed source file now exists at `supabase/functions/discover-menu-read/index.ts` on the hardening branch.

The recovered behavior:
- Authenticates a Supabase bearer token.
- Verifies the observation belongs to that user.
- Signs private menu image URLs for 10 minutes.
- Calls Anthropic's `claude-haiku-4-5` (unless `DISCOVER_MENU_MODEL` overrides it) with a strict transcription tool schema.
- Persists extracted items and extraction payloads, then marks observations ready for user review.

The reconstructed source adds an independent database-backed `discover_rate_limit` call, bucket `menu_read`, 10 requests per subject per 60 seconds, and fail-closed behavior. A second limiter is called immediately before each Anthropic request: bucket `menu_read_page`, 20 actual model calls per subject per 60 seconds. This prevents one 12-page request from multiplying a request-level limit into 120 paid model calls. It also adds explicit browser-origin allow-listing and a 2 KiB JSON body limit. It is labeled as reconstructed and must be reviewed against the live artifact before deployment. No live function was replaced.

### First automated CI execution exposed the real baseline

The newly added GitHub Actions workflow did run. `npm ci` succeeded, but root TypeScript validation failed. The errors exposed that the root Expo tsconfig was unintentionally pulling in unrelated code:
- the old archived Floot Marty source;
- the unfinished Fastify API workspace, whose dependencies are not in the root package;
- Deno Edge Function files, which need Deno's type/runtime checker;
- app-only issues: one `.tsx` import option, one untyped mock Journey section, and two permission-mock return types.

The CI workflow was corrected to:
- run Node 22 (the lockfile resolves Supabase JS 2.119.0, whose packages declare Node >=22);
- scope the root TypeScript check to `app/`, `src/`, and `tests/`;
- validate the two Supabase Edge Functions separately using Deno;
- then run the full Vitest suite and Expo web export.

The new workflow run is in progress. No green validation result is claimed until the latest run completes. The Fastify API workspace remains a separate build task; it is not being hidden by claiming that root app typecheck validates it.

The recovered tool schema includes a `brands` array, and the full model tool payload is retained in `observation_extractions.ocr_payload`. The current normalized `observation_items` table has no dedicated brand column, so brand values are not promoted to normalized item fields yet. Do not silently overload `listed_ingredients`; if product requirements need first-class brand search/display, add a reviewed schema/API contract in a new timestamped migration after migration-history reconciliation.


## Current implementation status — 10 November 2026, 21:17 UTC

This section supersedes the earlier statements in this document that the correction-index migration was source-only and that no migrations had been applied after the read-only audit.

### DEV-only migrations now applied

- `20261110211524_discover_harmony_sync_staging`: creates private schema `harmony_sync` with `staged_candidates`, `sync_ledger`, `review_events`, and `canonical_mappings`.
- `20261110211548_observation_correction_fk_indexes`: adds indexes for `observation_item_corrections.consumer_id` and `observation_id`.
- `20261110211821_discover_sync_permission_audit`: requires a constrained permission basis and auditable permission reference for each staged candidate.
- `20261110215901_marty_bartender`: creates Marty voice consent, user-entered memories, private Comedy Lab evaluations, and a service-only atomic voice rate limiter.
- `20261110215936_marty_private_table_grants`: removes inherited PUBLIC/anon grants from Marty tables and removes all client grants from the voice rate-limit table.

All five migrations are recorded in the live Discover DEV ledger and source filenames are aligned to the exact ledger versions. No Marty Edge Function has been deployed.

### Staging schema security verification

- All four `harmony_sync` tables have RLS enabled.
- `anon` and `authenticated` have no schema USAGE and no table SELECT privilege.
- `service_role` has schema USAGE and table SELECT privilege.
- No staging rows exist; no ingestion writer, reviewer UI, sync worker, or production connector exists yet. Candidate writes now require one of `public_source_license`, `explicit_contribution_consent`, or `operator_attested_permission`, plus a non-empty permission reference.
- The schema is not exposed to the client roles. The database setting for exposed API schemas is unset (default behavior), and the client roles have no schema USAGE regardless.

### Marty table security verification

- `bartender_voice_consents`, `bartender_memories`, and `bartender_comedy_evaluations` have RLS enabled; authenticated users retain explicit table grants but access is restricted by owner policies. Anonymous table access is revoked.
- `marty_voice_rate_limits` has RLS enabled and no anon/authenticated table privileges. Only `service_role` has table privileges.
- `consume_marty_voice_rate_limit(uuid,timestamptz,integer)` is `SECURITY INVOKER`, executable only by `service_role`, and not executable by anon/authenticated.
- The first ACL check exposed inherited PUBLIC privileges on newly created tables. A follow-up migration removed them; a second live privilege query confirmed anon SELECT is false on all four Marty tables, authenticated SELECT is false on the rate-limit table, and service-role SELECT remains true.

### Advisor results after migrations

- The two missing foreign-key index findings on `observation_item_corrections` have cleared.
- The security advisor reports four additional RLS-enabled/no-policy findings for the private staging tables. This is intentional default-deny service-only access, not a request to add client policies.
- Existing service-only tables continue to generate no-policy informational findings.
- The leaked-password-protection warning remains.
- Unused-index findings increased because the new tables and indexes have no workload yet. Do not remove them before realistic workload measurements.

### Harmony production schema mapping

Read-only catalog inspection of original Harmony confirmed the canonical model:
- `accounts` → venue identity.
- `menus` → menu identity and source/account association.
- `menu_sections` → menu hierarchy.
- `menu_items` → orderable menu lines.
- `sources`, `observations`, `field_provenance`, and `observation_reviews` → evidence, provenance, and review.
- `brands`, `products`, `cocktail_specs`, and `cocktail_spec_components` → canonical beverage/product intelligence.

Important identity constraint: `menus.account_id` references the text key `accounts.account_id`, whereas `observations.account_id` references the UUID `accounts.id`. These keys must never be interchanged.

Canonical menu vocabularies and required fields were inspected and recorded in `docs/DISCOVER_TO_HARMONY_CANONICAL_MAPPING_2026-11-10.md`. In particular, Discover's `beverage_category` does not map directly to Harmony's narrower `menu_items.item_type` vocabulary.

The inspected canonical tables expose SELECT policies to authenticated/Harmony reader roles, but no authenticated INSERT/UPDATE/DELETE policies were found on the inspected menu/source/provenance/review tables. This points to a server-mediated write path. That path still must be traced in Harmony application/server code before any production integration. Harmony production remains read-only and has received no writes.

### CI status

CI passed on commit `bfd8baca95a833613e02cdf0b1c0e3ab306f30ed`, including TypeScript, both Deno checks, all unit tests, and Expo web export. A fresh validation run is pending for the subsequent docs and migration filename-alignment commits. Do not infer latest-head success from the earlier green run.


### Consent-gated Discover → Harmony staging routine — 10 November 2026

- Applied migration `20261110221751_discover_consent_gated_menu_staging` to `harmony-discover-dev` only.
- Added `harmony_sync.stage_eligible_menu_observations(integer)`, a SECURITY INVOKER routine. Execute is revoked from PUBLIC, anon, and authenticated; service_role only is granted execute. Schema USAGE is service_role only.
- Eligibility requires completed status, processing consent, explicit per-observation contribution consent, current non-withdrawn `aggregate_research` consent, confirmed venue, complete pages, no dispute, zero unresolved flags, and saved structured menu.
- Staged payload omits consumer IDs, auth IDs, storage paths, signed URLs, private taste profiles, and conversations. Permission reference retains consent record ID and policy version only.
- New candidates start pending; sync ledger starts blocked. This is intentional: there is no automatic promotion or production sync worker.
- Runtime no-op test returned 0. Live DEV contains zero menu observations and zero staged candidates, so no personal data was staged. A consented fixture test remains to be run after the first authorized test record is created.
- Security advisor still reports 18 RLS-enabled/no-policy informational findings, including the service-only integration schema tables. The schema is inaccessible to anon/authenticated and service_role-only; no broad policies were added.


### Reviewer state machine and evidence immutability — 10 November 2026

Applied Discover DEV migrations:
- `20261110221859_discover_sync_review_state_machine`
- `20261110221907_discover_sync_review_validation`
- `20261110221926_discover_sync_immutable_evidence_audit`

The service-role-only `harmony_sync.record_candidate_review(uuid,text,text,text)` routine accepts only approved, rejected, conflict, or withdrawn decisions; requires reviewer label and reason; locks the pending candidate; requires a matching sync-ledger row; appends a review event; and keeps the ledger blocked. Approval cannot enqueue or authorize a Harmony production write.

A BEFORE UPDATE trigger prevents mutation of staged evidence, source identity/version, confidence, permission basis/reference, payload hash, and idempotency key. Review events are append-only at the table-privilege level: service_role has SELECT/INSERT but no UPDATE/DELETE. Live ACL verification confirms anon/authenticated have no schema USAGE or review-event access; service_role has SELECT/INSERT and no UPDATE/DELETE. The review and staging functions are SECURITY INVOKER and executable only by service_role.

All three migration filenames now match the exact versions in the live Discover DEV ledger. No staging records exist, so reviewer transitions have not yet been tested with a consented fixture.


### Review and evidence-integrity smoke test

A temporary synthetic DEV-only staged candidate was created inside a database test block, reviewed through `record_candidate_review`, and checked for the expected state: candidate became `approved`, review event was appended, and sync ledger remained `blocked`. An attempted payload mutation was rejected by the immutability trigger. The test removed its temporary review event, ledger row, and candidate. A follow-up count confirmed all three tables returned to zero rows. This verifies the database state machine and trigger behavior without staging user data or contacting Harmony.


### Final validation run — 10 November 2026, 22:22 UTC

GitHub Actions validation completed successfully for commit `f7932b404439ab02656e347018e7926a3393ddfc` (workflow runs 42913768999 and 42913759722). All steps passed: locked dependency install, Node 22 setup, Deno setup, TypeScript validation, both Discover DEV Edge Function checks, full Vitest suite, and Expo web export. This confirms the source branch validates and exports; it does not constitute a Netlify deployment or an audio/device audition.

The deployed Discover DEV `discover-voice-session` function was fetched and compared against the hardening branch source. Its deployed version 4 contains the same origin allow-list, body validation, consent checks, rate limiting, user-approved memory isolation, 60-second client-secret lifetime, and provider error redaction. The required `DISCOVER_ALLOWED_ORIGINS` value and credential presence remain unverified because Supabase function secrets are not readable through the available API. No credential was minted and no audio session was started.


### Contribution grant correction — 10 November 2026

The first staging routine incorrectly depended on the legacy `consent_to_contribute` field, despite the contract marking that field deprecated. Corrected in Discover DEV by `20261110222519_discover_observation_contribution_grants`: staging now requires a dedicated observation-specific grant row linked to the same consumer and observation, with a policy version and no withdrawal timestamp. The old flag is no longer referenced by the current function.

Live ACL check: RLS enabled; anon/authenticated have no table privileges; service_role has SELECT/INSERT/UPDATE. Staging function is SECURITY INVOKER, service_role execute only. Counts at verification: zero observations, zero contribution grants, zero staged candidates.

This table is only a backend gate. No consumer-facing consent wording, affirmative capture UI, or grant/revocation endpoint exists yet. Do not create real grants manually; implement and review the actual user-facing permission flow before staging can be used.


### Legacy API consent-field cleanup

The older Fastify observation route also accepted `consentToContribute` and persisted it to the deprecated `menu_observations.consent_to_contribute` field. Removed that input and write in the Discover source branch. The current mobile client already sends only the versioned menu-processing notice and does not request contribution permission. The new contribution-grant table remains unwired until a distinct, optional, unchecked-by-default consent UI and authenticated grant/revocation API are implemented with reviewed wording.


### Contribution permission interaction and staging-state correction — 10 November 2026

Implemented in Discover source: post-review, optional, unchecked-by-default contribution choice with explicit scope and withdrawal UI. Added authenticated GET/POST/DELETE API handlers under `/v1/observations/:id/contribution`; exact policy version validation; owner-scoped transactional grant/withdraw RPCs; immutable grant-event audit rows; regrant support with one active grant per observation. The DEV RPCs are SECURITY INVOKER and service_role-only. No real grant records exist.

Found and corrected two more staging prerequisites while tracing the actual menu-reader path: the reader sets observation status to `ready_for_review` (not `complete`), and the API was not persisting the explicit processing-notice acknowledgement into `consent_to_processing`. The staging function now checks `ready_for_review`; observation creation now validates the exact processing notice version and persists `consent_to_processing=true` only after the existing UI acknowledgement. The reconstructed reader source now records `all_pages_complete` and `structured_menu_saved` after confirming persisted item rows. These are source changes only; the reconstructed reader has not been deployed.

The staging routine still requires `venue_confirmed=true`; no venue-confirmation interaction has been implemented yet. Thus no user data can enter staging. No staging rows or contribution grants exist. The API source changes are not yet in the generated deployed Edge Function bundle and neither Netlify nor Supabase Edge Functions were deployed.


### Latest consent and staging corrections — 10 November 2026

- Added owner-scoped venue confirmation endpoint `POST /v1/observations/:id/venue-confirmation`; the review screen requires the user to confirm the venue name before contribution opt-in.
- The contribution grant RPC now independently requires ownership, ready-for-review state, processing acknowledgement, venue confirmation, all pages complete, structured items saved, no dispute and zero unresolved flags.
- Withdrawal now also blocks any not-yet-promoted staging candidate, changes its review status to `withdrawn`, appends a review event and leaves its sync ledger blocked. Already-promoted canonical records require a separate deletion review; no such promotion path is active.
- Exact DEV migration ledger timestamps: grant lifecycle `20261110222941`; ready-for-review staging state `20261110223114`; grant eligibility `20261110223437`; withdrawal blocks staged candidates `20261110223506`.
- The menu reader source now writes `all_pages_complete` and `structured_menu_saved` after checking persisted item rows. The Discover API source records the explicit processing notice as `consent_to_processing=true` and validates the exact notice version.
- No observations, grants, grant events or staged candidates are present. No deployed app/API/reader changes have been made. CI is being rerun after the backend test path was moved outside the Expo TypeScript include scope.
