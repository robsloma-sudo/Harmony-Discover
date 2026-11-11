# Harmony Discover → Harmony ingestion contract (v0.1)

**Status:** design contract only. No production writes, no live synchronization, and no Harmony production schema changes are authorized by this document.

## System boundaries

- **Harmony Discover** is the source of observations, extraction evidence, user-submitted corrections, and explicitly consented learning signals.
- **Discover DEV Supabase** is the development persistence environment. Its project ref is `lqqmwqrffelgnbngrkep`.
- **Integration staging** is a separate, reviewable boundary. For the first implementation it may live in the Discover DEV project, in a dedicated private schema. It must not share user-facing tables or permissions.
- **Original Harmony** remains the canonical production application and is read-only during this development phase. Its project ref is `lqjtwabzmgjcufftuqvu`. No migration, SQL, Edge Function deployment, or data write may target it without a separate explicit approval.

## Transfer principles

1. Default is **no transfer**. A record becomes eligible only after its evidence and permission gates pass.
2. Keep source evidence immutable. Corrections append a new version or correction event; they do not erase the original observation.
3. Every transferred record carries provenance, review state, and a stable source identity.
4. Synchronization is authenticated, idempotent, versioned, replay-safe, and auditable.
5. Do not transfer personal conversation transcripts, private memories, account identifiers, or unaggregated consumer profiles into Harmony.
6. Do not treat an AI extraction as verified fact. Human review or a separately defined trusted source is required for canonical promotion.
7. Do not overwrite a canonical Harmony entity on a key collision. Create a conflict for reconciliation.

## Current Discover consent boundary

The current menu-scan UI asks the user to agree that menu photos will be uploaded to Discover and processed to transcribe the printed menu. The UI explicitly says this is separate from optional research or personalization consent. That processing notice is **not** permission to publish, syndicate, or promote the menu into Harmony's canonical database.

The older `consent_to_contribute` field is marked deprecated in the live Discover schema and is not used by the current staging routine. The current backend requires a separate row in `public.observation_contribution_grants`, linked to the same observation and consumer, with a versioned policy and no withdrawal timestamp. This table is service-role-only and RLS-enabled. It is not yet wired to consumer-facing consent capture or revocation; do not create real grants until that explicit UI/API and reviewed notice are implemented. A verified public-source license may be a separate permission basis in a future reviewed flow, but is not currently wired into staging.

## Initial eligibility matrix

| Discover record | Staging eligibility | Promotion gate |
|---|---|---|
| Menu item observation | Yes, after ownership/permission checks | Human verification of name, category, price, venue/source, and date |
| Cocktail ingredient/spec observation | Yes, after extraction validation | Ingredient normalization, quantity/unit validation, source citation, reviewer approval |
| Venue/menu metadata | Yes, minimal fields only | Venue identity resolution and source validation |
| Consumer taste signal | Aggregate only, and only with a documented consent basis | Aggregation threshold, de-identification review, permitted purpose |
| User correction | Yes, as a correction event | Reviewer resolves against original evidence and canonical record |
| Personal conversation or private memory | No | Never automatically promoted |
| Comedy Lab evaluation | No | Separate product research domain; no ingestion into beverage knowledge |

## Envelope required for every staged record

- `contract_version`: semantic version of this envelope.
- `source_system`: fixed value `harmony_discover`.
- `source_project_ref`: Discover DEV project ref; never infer from request payload.
- `source_table` and `source_record_id`: exact origin.
- `source_version`: monotonically increasing record/correction version.
- `entity_type`: controlled vocabulary such as `menu_item_observation`, `cocktail_spec_observation`, or `venue_observation`.
- `canonical_key`: optional resolved key; null until identity resolution.
- `payload`: allow-listed domain fields only; no free-form transcript or private memory.
- `evidence`: source URL or asset reference, capture timestamp, page/position, and content hash where available.
- `evidence_state`: e.g. `menu_observed`, `text_verified`, `reviewed`.
- `confidence`: numeric 0–1 only when the producing method defines a calibrated interpretation; otherwise null.
- `permission_basis`: constrained to `public_source_license`, `explicit_contribution_consent`, or `operator_attested_permission`; never treat the menu-processing notice as this permission.
- `permission_reference`: required audit reference (e.g. stable license/source URL, versioned consent notice ID, or operator approval record ID), 1–500 characters; do not store raw consent text here.
- `payload_hash`: deterministic hash of normalized allow-listed payload.
- `idempotency_key`: deterministic key derived from source system + table + record ID + source version + entity type.
- `review_status`: `pending`, `approved`, `rejected`, or `conflict`.
- `created_at`, `observed_at`, `staged_at`, and `reviewed_at`: distinct timestamps; do not substitute one for another.

## State machine

`observed → extracted → validated → staged → approved → promoted`

Alternate terminal/review states:

- `rejected`: reviewer rejects the candidate; retain audit record and reason.
- `conflict`: identity or content conflicts with a canonical entity; block promotion until resolved.
- `withdrawn`: applicable permission basis is withdrawn before promotion; block future use and follow the relevant deletion/retention policy.

A transition must record actor/service identity, prior state, new state, timestamp, reason, and contract version. No client may set `approved` or `promoted` directly.

## Idempotency and conflict rules

- Unique staging identity: `(source_system, source_table, source_record_id, source_version, entity_type)`.
- Replaying the same key and same payload hash is a no-op.
- Replaying the same key with a different payload hash is a conflict, not an update.
- A new source version creates a new candidate version linked to the previous one.
- Canonical entity updates require explicit reviewer approval and a canonical mapping; no last-write-wins behavior.
- Promotion writes a receipt containing the staging ID, canonical entity ID, payload hash, mapping version, reviewer, and timestamp.

## Security and operational controls

- Use a dedicated private schema/table set for staging; enable RLS as defense in depth and expose no staging tables to browser clients.
- Service-to-service authentication only. Never ship a service-role key to a client.
- Verify caller identity, expected project, and environment on every integration endpoint.
- Enforce per-user and per-service rate limits, request size limits, strict allow-lists, and no-store responses for sensitive payloads.
- Keep a durable synchronization ledger with attempt count, last error code, next retry time, and terminal status. Never log secrets, signed asset URLs, transcripts, or full private payloads.
- Retry only transient failures. Validation, permission, and identity conflicts require review, not automatic retries.
- Support dry-run mode that produces a proposed diff without writing canonical records.

## First implementation sequence

1. Confirm the actual Discover DEV schema and source-table constraints.
2. Create private staging and ledger schema in Discover DEV only.
3. Implement a staging writer that accepts only allow-listed record types and validates the envelope server-side.
4. Add a review queue and approval audit trail.
5. Build a dry-run canonical mapper against a read-only snapshot/schema description of Harmony.
6. Test replay, duplicate, conflict, permission withdrawal, retry, and deletion scenarios.
7. Only after user approval, define a narrowly scoped production integration endpoint and promotion permission. No broad production database credentials.

## Open decisions

- Exact canonical tables and identifiers in Harmony must be mapped from a read-only schema inventory before choosing `canonical_key` formats.
- Decide which trusted menu sources, if any, can bypass manual review; default remains manual review.
- Define aggregation thresholds and consent wording for consumer taste signals before any aggregate leaves Discover.
- Define retention and deletion propagation for staged evidence and approved records.
- Confirm whether the integration staging schema should remain in Discover DEV or become a dedicated project after cost/ownership review.

## Non-goals

This contract does not authorize automatic consumer profiling, conversation ingestion, private-memory export, production writes, canonical overwrites, or deployment to the original Harmony application.


## Current DEV implementation note

Migration `20261110222519_discover_observation_contribution_grants` adds the observation-specific grant table and replaces the staging routine. The routine no longer reads the deprecated `consent_to_contribute` flag. It requires a grant row linked to the same observation and consumer, with a policy version and no withdrawal timestamp. RLS is enabled; anon/authenticated have no table privileges; service_role has SELECT/INSERT/UPDATE. The staging function is SECURITY INVOKER and service_role-only.

The original migration note above is historical. See the latest implementation gates below for the current source status.


## Implemented contribution-permission interaction (DEV source only)

The menu-review screen now offers a separate, affirmative opt-in after extraction results are shown. The choice is not preselected and is not part of the menu-photo processing acknowledgement. The notice limits the proposed contribution to extracted menu details (item names, descriptions, prices, venue name and scan date) for a private human-review queue; it says the menu is not automatically published and excludes menu photos, private conversations, memories and account details. The screen also provides a withdrawal action.

Authenticated API source handlers support GET, POST and DELETE at `/v1/observations/:id/contribution`. The server uses the authenticated subject ID, validates the exact policy version, and calls service-role-only transactional database functions. Grants require an observation owned by the caller and currently in `ready_for_review`. Withdrawal marks the active grant withdrawn and writes a separate immutable grant-event record; a later re-grant can create a new grant while the partial unique index permits only one active grant per observation.

The DEV schema now has a grant-event audit table and two service-role-only SECURITY INVOKER RPCs. Regrant/withdraw history is preserved. No real grants exist in DEV. These API changes are source-branch only; the generated `discover-api` deployment bundle and Netlify app have not been deployed.


## Latest implementation gates (supersedes earlier status notes)

The current Discover source branch implements three distinct confirmations in order:

1. The existing menu-processing acknowledgement is recorded as `consent_to_processing=true` with the exact accepted notice version. This is only permission to process the uploaded photos for the scan.
2. After extraction, the user confirms the venue name through a separate owner-scoped endpoint. The endpoint only accepts observations in `ready_for_review`.
3. The user may separately opt in to contribution. This action is unavailable until the venue has been confirmed. It covers extracted menu fields and user-saved corrections for a private human-review queue, not automatic publication.

The contribution grant RPC independently checks ownership, `ready_for_review`, processing consent, venue confirmation, complete pages, saved structured items, no dispute and zero unresolved flags. It does not trust UI state. The staging routine independently checks the same scan-quality gates and requires an active observation-specific grant. The reader source now persists `all_pages_complete` and `structured_menu_saved` from the actual page/item results.

Withdrawal marks the active grant withdrawn, appends a grant-event record, changes any not-yet-promoted staged candidate to `withdrawn`, appends a review event and keeps the sync ledger blocked. A later grant can be created as a new versioned grant. Withdrawal cannot silently retract an already-promoted canonical record; that requires a separate deletion/review process. No promotion worker or production integration is active.

The grant/withdraw and venue-confirmation API handlers, mobile UI and reader status changes are source-branch only. They are not deployed to the live Discover app or Edge Functions. No real grants or staged records exist in DEV.


### Additional safety correction — 10 November 2026

Menu scans are now capped at 12 image pages. The authenticated upload handler checks the current owned, non-deleted asset count before storing another image and rejects page 13. The reader independently requests an exact asset count and refuses to set `all_pages_complete=true` when the observation exceeds 12 pages. This closes a partial-scan edge case caused by the reader's bounded 12-asset query. CI now builds a self-contained API Edge Function bundle from the shared source and validates the generated entrypoint; the bundle output is git-ignored and must be regenerated with `npm run build:edge` before deployment.
