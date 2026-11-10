# Discover → Harmony canonical mapping (read-only schema comparison)

**Date:** 10 November 2026  
**Status:** Schema mapping only. Harmony production was queried read-only. No Harmony writes or schema changes.

## Environments

- Discover DEV: `lqqmwqrffelgnbngrkep`
- Original Harmony production: `lqjtwabzmgjcufftuqvu` — read-only.

## Main finding

Discover already captures menu observations and OCR candidates, while Harmony has a mature canonical data model. They should not be merged table-for-table. Discover records are *evidence candidates*; Harmony records are canonical entities with source, venue, provenance, verification, and merge history.

## Proposed entity mapping

| Discover DEV | Harmony canonical destination | Mapping rule |
|---|---|---|
| `menu_observations` | `menus` + `observation_reviews` (not direct) | A menu observation is a candidate capture. Promote only after venue identity and review gates. |
| `observation_assets` | `menus.source_file_url` or evidence reference | Do not copy signed URLs. Retain stable source/evidence reference and content hash; decide asset retention/licensing separately. |
| `observation_extractions` | `menus.raw_content` / extraction evidence | Preserve OCR payload and model as source evidence in staging; do not treat raw OCR as canonical menu content without review. |
| `observation_items` | `menu_sections` → `menu_items` | Section and item are candidate rows. Map name to `item_name`, category to `item_type`, price text to `price_text`; only populate numeric `price` after safe parsing and currency context. |
| `observation_item_corrections` | `field_provenance` + review/audit trail | Keep before/after correction history; do not discard original extraction. A correction is not automatically a verified value. |
| `learning_events` | No direct destination | Not a beverage fact source. Never bulk-copy events to Harmony. |
| `personal_taste_profiles`, `learning_question_records` | No destination | Private personalization/question data is excluded from canonical Harmony. |
| `learning_trend_candidates`, `learning_research_tasks`, `learning_improvement_proposals` | No automatic destination | Product learning workflow, not canonical beverage data. |

## Canonical tables confirmed in Harmony

- Venue identity: `accounts` (UUID `id`, stable text `account_id`, `account_name`, `data_permission_status`, website and geography fields).
- Menu identity: `menus` (UUID `id`, text `menu_id`, text `account_id`, `source_id`, `evidence_url`, capture date, content hash, current/supersession fields).
- Menu hierarchy: `menu_sections` → `menu_items`.
- Source authority: `sources`.
- Canonical beverage identity: `brands`, `products`, `cocktail_reference`, `cocktail_specs`, `cocktail_spec_components`.
- Evidence/provenance: `observations`, `field_provenance`, `observation_reviews`.
- Existing review/conflict infrastructure: `data_quality_issues`, `fact_conflicts`, `entity_merges`.

## Important identity details

- `menus.account_id` references `accounts.account_id` (text), while `observations.account_id` references `accounts.id` (UUID). These are intentionally different keys. The integration must resolve both correctly and must not confuse them.
- `menus.source_id` references `sources.id`. Discover must not invent a source ID. A trusted source record must be resolved or proposed for review.
- `menu_items.section_id` references `menu_sections.id`; the section row must be created/resolved before its items.
- `cocktail_specs` and `cocktail_spec_components` are structured canonical recipe entities. A menu listing named “Old Fashioned” is not sufficient evidence to create or overwrite a cocktail spec.
- `brands` and `products` require identity resolution. OCR brand strings should remain raw evidence until matched to an existing brand/product or reviewed as a new candidate.
- Discover's `menu_observations.venue_id` is a UUID field but was not found to establish a direct FK to Harmony `accounts`; it must not be interpreted as a Harmony account ID.
- The Discover menu item schema has no normalized brand column. The reconstructed menu reader retains extracted brands in `observation_extractions.ocr_payload`; do not move brand text into `listed_ingredients`.

## Canonical value constraints confirmed

- `menus.menu_format`: `html`, `pdf`, `image`, `other`.
- `menus.extraction_confidence`: `high`, `medium`, `low`, `unknown`.
- `menus.raw_content_type`: `markdown`, `html`, `pdf_text`, `ocr_text`, `vision_json`.
- `menu_sections.section_type`: `cocktails`, `spirits`, `wine`, `beer`, `food`, `other`, `unsectioned`.
- `menu_items.item_type`: `cocktail`, `spirit_pour`, `flight`, `bottle`, `shot`, `other`, `unknown`. This is not the same vocabulary as Discover's `beverage_category`; do not directly copy `wine`, `beer`, `food`, or `non_alcoholic` into `item_type`.
- `observation_reviews.review_status`: `unreviewed`, `matched`, `verified`, `rejected`, `needs_research`.
- `field_provenance.status`: `verified`, `source_backed`, `inferred`, `unresolved`, `conflicting`, `deprecated`, `discontinued`, `unknown`, `needs_review`.
- `sources.source_type`, `evidence_class`, `authority_tier`, `access_method`, `licence_status`, and evidence purpose/stage arrays are constrained vocabularies. The integration must use a reviewed source mapping and must never invent authority tier or licence status.
- `menus.account_id`, `menus.source_id`, and `menus.evidence_url` are required. The integration must resolve a valid Harmony account key, source record, and stable evidence URL/reference before menu creation.

## Existing Harmony canonical menu intake (important discovery)

The original Harmony production project already has a canonical intake path:

1. Edge Function `submit-menu` (ACTIVE v27, `verify_jwt=false`) accepts a server-to-server request guarded by the `x-agent-secret` header.
2. It validates the account key, publisher-owned HTTPS evidence URL, menu format/confidence, section types, and brand category payload.
3. It calls the `public.submit_menu(..., p_needs_vision_pass boolean)` RPC.
4. The RPC is `SECURITY DEFINER`, fixed to `search_path=public, pg_temp`, and executable only by `service_role` and `postgres` (not `anon`, `authenticated`, or `PUBLIC`).
5. The RPC creates menu/section/item/brand-link rows, resolves source IDs from `sources.source_code`, computes content hashes, deduplicates identical captures, handles current-menu supersession/alternate captures, and performs cocktail-reference inference when appropriate.

The active `promote-menus` worker is a separate feeder for the existing `staging_menu_extract` queue. It selects quality-approved rows, requires the pre-registered `NBCC-FIRECRAWL-MENUS` source, and submits batches through `submit-menu`. It is not a generic Discover integration worker and must not be pointed at Discover tables.

**Recommended future integration:** after explicit production authorization, build a narrowly scoped server-side adapter that converts approved Discover candidates into the existing `submit-menu` payload and calls the canonical intake path. Do not write directly to `menus`, `menu_sections`, `menu_items`, or `menu_item_brands`; preserve the existing canonical dedupe/supersession logic.

**Hard evidence constraint:** `submit-menu` requires a publisher-owned HTTPS `evidence_url` and rejects scraper/cache URLs. A Discover photo upload does not automatically supply such a URL. If there is no stable, permitted public source URL (or a separately approved new evidence intake contract), the candidate cannot use this existing path and must remain in Discover staging. Do not substitute a temporary signed Storage URL or invent a public URL.

The `AGENT_SECRET` was not retrieved. No request was sent to the production intake endpoint, and no production data was written.

## Production write-boundary observations

The inspected Harmony tables expose SELECT policies for authenticated readers and dedicated Harmony/menu-designer roles. The inspected `menus`, `menu_sections`, `menu_items`, `sources`, `field_provenance`, and `observation_reviews` tables had no authenticated INSERT/UPDATE/DELETE policies in the inspected policy inventory. This is consistent with a server-mediated canonical write path; the integration must not attempt direct browser writes.

Only two triggers were found on the inspected set: `sources_set_updated_at` and `observation_reviews_set_updated_at`, both BEFORE UPDATE. No menu/menu-section/menu-item insert/update triggers were found in the inspected inventory. This does not prove that there are no dependent RPCs, views, functions, or application-side invariants. The canonical write path still needs to be traced through the actual Harmony server code before any production integration.

## Promotion pipeline (proposed)

1. Discover menu observation and its assets/extractions/items are copied to private integration staging with exact source IDs, version, content hash, and evidence pointers.
2. A reviewer confirms venue identity and checks that the venue/menu source may be used.
3. Resolve or propose a Harmony `accounts` identity. Uncertain matches enter conflict review.
4. Resolve or propose a Harmony `sources` record. Never invent authority tier or source permissions.
5. Create a candidate menu mapping with account text key, source UUID, evidence URL/reference, capture date, format, content hash, and provenance.
6. Create/resolve sections, then create candidate items. Keep original OCR and correction history linked.
7. A separate reviewer approves canonical promotion. Promotion writes a receipt and per-field provenance; replay of the same source version is a no-op.
8. Canonical cocktail, brand, product, and flavor-intelligence entities require their own identity and evidence gates; no inference from a menu item alone.

## Outstanding verification before any production integration

- Inspect constraints and triggers on `menus`, `menu_sections`, `menu_items`, `sources`, and `field_provenance` before generating insert statements.
- Confirm exact `menu_format`, `menu_scope`, `menu_type`, `item_type`, and review-status controlled vocabularies.
- Confirm data-permission rules and source licensing for each venue/menu.
- Define whether source menu imagery may be retained or only referenced.
- Confirm canonical menu and menu-item write paths do not require additional derived columns or side effects.
- Build and test only against isolated DEV fixtures. No production write until the user approves a narrowly scoped integration.

## Explicit exclusions

No personal conversations, private memories, consumer IDs, private taste profiles, or unaggregated learning events are candidates for transfer. Harmony remains read-only until separately authorized.


## Code-level dry-run mapper

The repository now includes `src/integration/harmonySubmitMenuMapper.ts` and `tests/harmony-submit-menu-mapper.test.ts`. The mapper accepts only an explicitly reviewed Harmony menu draft; it does not infer account identity, source authority, public evidence URL, menu item type, price, currency, or brand mapping from Discover OCR. It validates the exact `submit-menu` field vocabularies, HTTPS publisher-owned evidence URL, SHA-256 content hash, non-negative positions, numeric price strings, currency code, brand category, and the PDF/image positive-item guard. It produces the request payload only; it does not call the production endpoint or write any data. Tests cover accepted mapping, blocked evidence URLs, empty PDF/image captures, invalid canonical fields, and preserving text-only prices without inventing a numeric amount.


## Consent-gated staging execution — DEV only

A service-role-only, SECURITY INVOKER routine now exists in Discover DEV: `harmony_sync.stage_eligible_menu_observations(integer)`. It selects only observations that meet every gate: status `complete`; processing consent true; per-observation contribution consent true; confirmed venue; all pages complete; no dispute; zero unresolved flags; structured menu saved; and the user's latest `aggregate_research` consent record is granted and not withdrawn.

The staged payload excludes consumer IDs, account IDs, storage object paths, signed asset URLs, and private taste/conversation data. It carries the consent record ID and policy version as permission provenance, source observation/item IDs, menu text/price/category/ingredient evidence, and latest correction values. Candidates are initially `pending`; the sync ledger is deliberately `blocked` pending independent human review and canonical mapping. No worker promotes anything to Harmony.

The function is SECURITY INVOKER and executable only by `service_role`; anon/authenticated execute privileges are false. Discover DEV currently has zero menu observations and zero aggregate-research consent records, so an actual execution returned `staged = 0`, with zero candidates, review events, or ledger rows. No user data was staged. This is a no-op verification, not an end-to-end test with a consented fixture.
