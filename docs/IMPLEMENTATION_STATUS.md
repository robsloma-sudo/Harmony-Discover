# Implementation status — v0.4

## Added in v0.4
- Versioned extraction schema with field-level confidence, evidence state, page number, source text, and method.
- Vendor-neutral OCR provider interface and optional HTTP adapter.
- Conservative literal line-item extractor.
- Extraction pipeline that stores OCR payload and processing events.
- Worker support for `extract_menu` jobs, enqueued only when OCR provider credentials are configured.

## Critical limitations
- OCR provider endpoint response contract is a generic adapter contract, not a pre-integrated vendor.
- No OCR credentials configured and no provider called.
- Extractor is deliberately conservative and can mis-segment lines; human review remains necessary.
- Extracted item records are returned by the pipeline but not yet persisted into a normalized observation-items table.
- No category classifier, canonical brand/product matching, venue matching, price normalization, multilingual evaluation, or Journey generation.
- No automated tests have been run.

## Not executed
No cloud project provisioned, migration applied, secret configured, app deployed, or production service modified.

## v0.5 product integration research
- Read-only inspection identified a substantial existing Harmony cocktail intelligence subsystem.
- Added `HARMONY_COCKTAIL_INTEGRATION.md` with verified table/view inventory, safe integration pattern, consumer experience, evidence model, API proposal, privacy boundary, and build sequence.
- No production rows were changed, copied, or exposed.

## v0.6 — Harmony Learning Engine specification

Added `HARMONY_LEARNING_ENGINE.md` defining the internal learning purpose, private taste intelligence, consented aggregate discovery intelligence, knowledge-gap detection, event taxonomy, data separation, trend lifecycle, privacy safeguards, metrics, MVP phases, acceptance criteria, and implementation backlog. This is a design specification only; no event instrumentation, tracking, schema deployment, or production writes were performed. Production Supabase remains read-only.

## v0.7 — Learning Engine scaffold
- Added isolated development migration `0003_learning_engine.sql`.
- Added versioned event contracts, consent-aware ingest policy, and unit-test examples.
- Added separate question vault, private taste profile, trend candidates, research tasks, proposals, and outcome measurement schema.
- Added implementation and privacy hardening checklist.
- **Not executed or deployed.** Existing Harmony production Supabase remains read-only.


## v0.8 — Learning signal evaluator

- Added deterministic 28-day current vs prior 28-day baseline evaluator.
- Enforces distinct-subject, distinct-session, observation-day, and baseline minimums.
- Filters out events without aggregate-research consent.
- Added tests for small samples, consent exclusion, and emerging signals.
- Results are internal product-learning signals, not claims about the wider market.
- No database job, dashboard, deployment, or production write performed.


## v0.9 — Learning Review Console preview

- Added internal Expo route `app/learning-console.tsx` with sample candidate queue, filters, evidence context, and local draft/defer interactions.
- Added role and approval workflow specification.
- Clearly labels all records as illustrative; no live consumer data or persistence.
- No production integration or database changes.


## v1.0 — Harmony Knowledge Gap Engine

- Added a pure TypeScript knowledge-gap evaluator across seven Harmony domains.
- Evaluates unanswered questions, low explicit satisfaction, and source-coverage signals without ingesting free text.
- Applies minimum distinct-subject and observation-span gates before assigning priority.
- Suggests whether to observe, audit existing knowledge, commission research, or review UX.
- Added tests for cohort suppression, consent exclusion, research prioritization, and domain separation.
- No production connection, database job, or canonical knowledge mutation.


## v1.1 — Knowledge Improvement Pipeline

- Added a pure TypeScript workflow state machine from candidate through research, evidence, approval, implementation, measurement, and rollback.
- Added evidence provenance contract and minimum independent-source gate.
- Enforced separation of duties: author/reviewer/approver/implementer cannot bypass independent approval.
- Added outcome measurement requirements and audit trail entries.
- Added workflow unit tests.
- Not connected to API or database; no deployment or production writes.


## v1.2 — Learning API integration scaffold

- Added authenticated consent read/write routes and consent-history recording.
- Added structured learning-event ingestion route with strict allow-list and server-derived subject identity.
- Connected routes to the existing isolated Discover API server.
- Question text is explicitly excluded from the event endpoint.
- Not compiled, run, deployed, or connected to a live database in this increment.
- Production Harmony remains read-only and untouched.
