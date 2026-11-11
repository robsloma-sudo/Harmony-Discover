# Continuation audit — Harmony Discover / Marty

**Audit date:** 10 November 2026  
**Audited source:** `robsloma-sudo/Harmony-Discover` branch `marty-boston-security-hardening-2026-11-10`, head `d5ac5f741072e9b34bce54754fd885eb091508d1`  
**DEV Supabase:** `lqqmwqrffelgnbngrkep`  
**Production Harmony:** `lqjtwabzmgjcufftuqvu` — read-only boundary preserved.

## Verified current source status

- Draft PR #1 remains open and unmerged.
- Two GitHub Actions runs for the audited head completed successfully: run 42921973339 and 42921965931.
- CI success is source validation only; it is not a Netlify deployment, Edge Function deployment, or end-to-end runtime acceptance.
- The branch contains contribution UI/API, 12-page limits, reconstructed menu-reader source with independent request/model-call limiters, DEV deployment runbook, canonical Harmony mapping, dry-run mapper and tests.
- The contribution UI separates photo-processing acknowledgement, venue confirmation and optional observation-specific contribution permission. It also supports withdrawal.
- The Harmony mapper accepts reviewer-authored menu drafts and validates canonical payload fields. It does not call production `submit-menu` and does not write to Harmony.

## Live DEV status

Latest live function inventory:
- `discover-api`: ACTIVE v6
- `discover-menu-read`: ACTIVE v3
- `discover-retention`: ACTIVE v1
- `discover-voice-session`: ACTIVE v4

The current branch's newer API contribution routes and the reconstructed menu-reader source are not yet deployed. The current deployed API v6 does not include the new contribution endpoints. Do not describe the new contribution UI/API as live.

Live Discover DEV counts at audit time:
- menu observations: 0
- observation contribution grants: 0
- contribution grant events: 0
- staged candidates: 0
- review events: 0
- synchronization ledger rows: 0

The staging, grant and withdrawal database functions exist in DEV. The staging function requires an active observation-specific grant, ready-for-review status, processing consent, confirmed venue, complete pages, saved structured items, no dispute and zero unresolved flags. It creates a pending review candidate and leaves the sync ledger blocked. Withdrawal blocks all unpromoted candidates for that observation and appends audit events.

No worker promotes candidates. No production sync request has been sent.

## Source reconciliation

The live migration ledger contains 28 migrations. The branch contains the original sources for migrations 0001–0003, the observation correction migration, and forward-only migrations aligned with the newer DEV schema.

Historical SQL remains missing for applied migrations:
- `0004_learning_consent_integrity` through `0009_rate_limit_and_cron_secret`
- `0011_pg_net_out_of_public`
- `0012_menu_reading`

Do not fabricate historical migration files or replay replacements against the live database. Recover exact original SQL from an authoritative backup if possible. Otherwise create a clearly labeled catalog-derived baseline/snapshot for fresh-environment bootstrap. The deployed `discover-menu-read` v3 artifact has been recovered as reconstructed source and requires a line-by-line review before deployment.

## Newly identified eligibility consistency question

DEV contains `public.discover_observation_qualifies(o, p_min_confidence)`, whose predicate includes:
- all pages complete;
- OCR confidence at least 0.90 by default;
- zero unresolved flags;
- not disputed;
- structured menu saved;
- venue confirmed;
- non-null `venue_id`.

However, the current live `discover_grant_observation_contribution` and `harmony_sync.stage_eligible_menu_observations` definitions do not call this helper. They enforce most of the other quality flags but do not enforce the 0.90 OCR threshold or non-null `venue_id`.

This is a policy inconsistency, not yet a proven exploit: the intended meaning of the helper and whether the Discover venue UUID must be resolved before staging needs an explicit decision. The source UI currently confirms a venue name; it does not itself prove that the internal `venue_id` is resolved. Before any staging job is activated, decide whether:
1. the helper is the canonical eligibility rule and both grant/staging functions must call it, with a venue-resolution step added; or
2. the helper is obsolete and should be revised/removed with a documented, calibrated confidence policy.

Do not silently change this gate. A stricter rule could block every current user flow until venue resolution is implemented.

## Harmony canonical boundary

Original Harmony has a mature `submit-menu` intake. The Discover mapper is a dry-run transformation only. The canonical intake requires a resolved Harmony account key, registered source code, and publisher-owned HTTPS evidence URL. A private Discover photo or temporary signed Storage URL is not an acceptable substitute. Discover menu observations must not be written directly into Harmony canonical tables.

The original Harmony production project was not modified. No production credentials were retrieved. No production endpoint was called.

## Remaining release gates

1. Resolve the eligibility-helper inconsistency described above.
2. Recover missing historical migration SQL or produce a clearly labeled baseline snapshot.
3. Review reconstructed menu-reader source against the deployed v3 artifact.
4. Verify required DEV function secrets and configure exact allowed browser origins without revealing secret values.
5. Deploy the reviewed API/reader source to Discover DEV only after explicit deployment approval.
6. Run authenticated synthetic tests for consent denial/approval, venue confirmation, contribution grant, listing, withdrawal, staging, review and replay/idempotency.
7. Test menu-reader rate limits both through the API and by direct function invocation.
8. Complete Marty voice consent, rate-limit, expiry, CORS, browser WebRTC and real audio audition tests. Native iOS transport remains unvalidated.
9. Only after successful DEV acceptance, request separate approval for any production integration. No PR merge, Netlify publish, production write or production deployment is authorized by this audit.


## Quality-gate reconciliation — completed in Discover DEV

Migration `20261110235839_discover_observation_quality_gate_v1` was applied to Discover DEV and committed to the source branch.

The earlier `discover_observation_qualifies` helper required `venue_id IS NOT NULL`, but the actual consumer venue-confirmation API only stores a consumer-confirmed venue name in `venue_name_submitted` and sets `venue_confirmed=true`. No venue-resolution workflow is implemented in this source path. The helper therefore blocked otherwise eligible user-confirmed observations based on a UUID that the UI cannot currently resolve.

The revised, shared quality gate:
- requires all pages complete;
- requires `min_ocr_confidence >= 0.90` (NULL fails closed);
- requires zero unresolved flags;
- rejects disputed observations;
- requires structured menu data saved;
- requires `venue_confirmed=true` and a non-empty consumer-confirmed/read venue name;
- no longer requires a non-null `venue_id` until a real venue-resolution workflow exists.

Both the grant RPC and staging routine now call the same helper. The staging evidence records quality gate version `discover-observation-quality-v1`, the actual OCR confidence and the 0.90 minimum threshold. Staging still requires a live observation-specific grant and leaves its sync ledger blocked.

### DEV verification

- Synthetic composite-row checks: valid 0.95 confidence + confirmed venue = true; 0.89 confidence = false; missing confidence = false; missing venue name = false; disputed = false.
- Grant and stage RPC execute privileges: anon=false, authenticated=false, service_role=true.
- No observations, grants, staged candidates, review events or ledger rows exist; no real user data was staged.
- Security Advisor reviewed. Existing INFO findings for RLS-enabled private tables without policies remain expected defense-in-depth behavior because browser roles have no table grants. Auth leaked-password protection remains a separate WARN requiring dashboard configuration.
- Original Harmony production remains read-only and untouched.

### Remaining acceptance test limitation

No authenticated synthetic observation fixture was inserted. The next test should create disposable test identities and observations in a rollback-only transaction or isolated DEV fixture, exercise grant → stage → withdrawal → replay, then verify every created row is removed or the isolated fixture is reset. Do not use real user data as a test fixture.


## Rollback-only synthetic integration test — passed

A disposable fixture was created inside a single database transaction and rolled back:
- synthetic Auth user;
- ready-for-review menu observation with processing consent and 0.97 OCR confidence;
- one menu item;
- observation-specific contribution grant;
- staged candidate and blocked sync ledger;
- idempotent second staging call returned zero;
- withdrawal changed the unpromoted candidate to `withdrawn`, kept the ledger `blocked`, and prevented restaging.

The SQL test raised an exception on any unexpected result and completed without error. A subsequent live count check confirmed zero observations, grants, grant events, staged candidates, review events or ledger rows. No real user data was used.

## Marty audio lifecycle hardening — source branch

Commit `a672a40c207c6572629f96f46530ec352c4c8eb7` updates `app/bartender.tsx`:
- screen blur/unmount closes the coordinator and all audio resources;
- browser `visibilitychange` to hidden stops the active voice session and requires a fresh start on return;
- hold-to-talk tracks whether a press actually began, preventing a stray release event from committing an empty audio turn;
- stop, interrupt and transport cleanup reset the press state.

This is source-only; the Netlify preview has not been published. CI is running for this commit. Previous full validation at `59cc0ebb132d4cde6dd1bb6921897a35941cd97a` passed TypeScript validation, Edge Function checks, all unit tests, and web export.


## Marty DEV runtime and security verification — 11 November 2026

**Project checked:** `harmony-discover-dev` / `lqqmwqrffelgnbngrkep` (ACTIVE_HEALTHY, Postgres 17.11).

### Deployment boundary

Live Edge Function inventory remains:
- `discover-api`: ACTIVE v6
- `discover-menu-read`: ACTIVE v3
- `discover-retention`: ACTIVE v1
- `discover-voice-session`: ACTIVE v4

The latest Marty source branch is `50a22f4c992363e166825b862214f8c13b2ca933`; both latest GitHub Actions runs (42928433061 and 42928426353) completed successfully. This is source/CI validation only. No Edge Function redeployment, Netlify deployment, PR merge, or production action was performed.

### Voice runtime findings

- The deployed `discover-voice-session` source has an exact-origin allow-list using `DISCOVER_ALLOWED_ORIGINS`, manual bearer-token validation, DEV project/environment guards, current voice-consent enforcement, a 4-per-minute user limiter, and a 60-second Realtime client secret.
- The deployed function calls `/v1/realtime/client_secrets` with model `gpt-realtime-2.1` and input transcription model `gpt-live-transcribe`.
- The Supabase MCP surface does not expose a secret-listing action. Therefore the presence of `OPENAI_API_KEY` and the exact configured `DISCOVER_ALLOWED_ORIGINS` value remain unverified. Do not claim these are configured until verified in the DEV dashboard or through a permitted secret-presence check that never reveals values.
- The last 30 days of targeted Edge Function logs returned no invocation entries for `discover-voice-session` (zero observed invocations in the queried logs).
- DEV has zero `bartender_voice_consents` rows, zero active voice consents, zero active memory consents, zero stored bartender memory rows, and zero voice rate-limit rows. No authenticated voice session or audio audition has occurred.
- The Realtime client now waits for `session.created`, not the separate Live API's `session.started`; cleanup stops microphone tracks immediately and closes the WebRTC transport directly.

### Database and RLS verification

Marty consent and memory tables have RLS enabled and owner-scoped policies. Consent reads/inserts/updates require the authenticated user's own `user_id`. Memory read/insert/update require owner match and active memory consent; owner DELETE remains available after consent withdrawal so users can erase their memories.

The following internal tables have RLS enabled, no anon/authenticated table grants, and service-role-only access: `marty_voice_rate_limits`, contribution grant/event tables, and the Harmony sync staging/review/ledger tables. The relevant RPCs are `SECURITY INVOKER` and EXECUTE is restricted to `service_role`.

Security advisor reports 20 RLS-enabled tables without policies (including private/internal tables). For the inspected internal tables, anon/authenticated privileges are absent; this is expected deny-by-default, not evidence of public exposure. The advisor also reports leaked-password protection disabled; this remains a project-level hardening recommendation and has not been changed.

Performance advisor reports unused indexes while the DEV data tables are empty. Do not remove indexes solely on this zero-traffic evidence.

### Empty-data verification

At audit time, counts were zero for:
- menu observations;
- observation contribution grants and grant events;
- Harmony staged candidates and sync ledger rows;
- Marty voice consent rows, active voice consent, active memory consent, stored memory rows, and rate-limit rows.

### Next acceptance gates

1. Verify secret presence and allowed browser origin in the Discover DEV dashboard without exposing secret values.
2. Enable voice consent explicitly for a designated test account.
3. Run authenticated negative tests (missing token, stale token, missing consent, wrong consent version, disallowed origin, and rate-limit exhaustion).
4. Run one authenticated positive browser WebRTC audition, then verify microphone release, interrupt, stop, background cleanup, token expiry, and no transcript-to-memory writes.
5. Validate on a real iPhone only after a native adapter exists; current voice path is web-only.
6. Keep all deployments scoped to Discover DEV and obtain separate approval before any deploy. Production Harmony remains untouched.
