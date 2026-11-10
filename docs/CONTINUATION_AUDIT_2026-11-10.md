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
