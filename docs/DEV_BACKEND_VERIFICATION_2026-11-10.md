# Discover DEV backend verification — 10 November 2026

## Scope

Read-only inspection of Supabase project `lqqmwqrffelgnbngrkep`. No database writes, schema changes, Edge Function deployments, Auth changes, or Netlify deployments were performed during this verification. Harmony production project `lqjtwabzmgjcufftuqvu` was not accessed or modified.

## Confirmed deployed functions

| Function | Version | State | JWT gateway |
|---|---:|---|---|
| `discover-api` | 3 | ACTIVE | `verify_jwt=false`; handler independently verifies the Supabase bearer token with `auth.getUser()` |
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
