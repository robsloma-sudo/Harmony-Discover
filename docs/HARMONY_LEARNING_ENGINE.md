# Harmony Learning Engine — Product & Technical Specification

**Status:** Design specification for isolated Harmony Discover development (build status: see section 16, checked 21 Nov 2026)  
**Version:** 0.6 draft  
**Production boundary:** Existing Harmony production Supabase remains read-only. This document proposes no production schema, function, policy, or deployment changes.

## 1. Mission

The Learning Engine turns consented Discover interactions into evidence about what people are curious about, what they enjoy, where Harmony's knowledge is incomplete, and which product experiences are or are not helping. Its purpose is to make Harmony itself more accurate, useful, relevant, and educational.

It is an internal product-improvement capability, not a consumer-data resale product. Consumer-level taste profiles remain private to the consumer. Aggregate signals may guide internal research and product decisions, subject to explicit consent and privacy safeguards.

## 2. Operating principles

1. **Improve Harmony, not sell people.** Do not sell, license, or expose identifiable consumer profiles, individual drinking histories, or private conversations.
2. **Consent is purpose-specific.** Personalization, aggregate product research, and analysis of free-text questions are separate choices. Declining optional research must not block core scanning and learning features.
3. **A signal is not a fact.** A click, save, question, or remix indicates behavior or interest; it does not prove a flavor preference, recipe fact, product quality, or market-wide trend.
4. **Evidence before canonical change.** Signals create hypotheses and research tasks. Canonical knowledge changes only after source-backed review and the relevant approval process.
5. **Minimize collection.** Capture only fields needed to improve a defined Harmony capability. Avoid raw GPS trails, unnecessary device identifiers, payment data, faces, and unrelated personal details.
6. **Separate personal from aggregate.** Individual taste and collection data are isolated from aggregate analytics and from any commercial-facing data products.
7. **Make learning measurable.** Every accepted improvement should have a stated problem, evidence, owner, version, and outcome metric.
8. **Respect alcohol context.** Do not optimize for greater consumption, frequency, or spend. Optimize for education, informed choice, relevance, and responsible discovery.

## 3. Learning domains

### A. Personal Taste Intelligence (private)

Purpose: improve an individual's recommendations and remix experience.

Potential signals:
- Explicit taste choices (e.g. dry, bitter, citrus-forward, herbal).
- Explicit dislikes and exclusions.
- Saved drinks and user-authored notes.
- Recipe edits (e.g. less sweet, more acidic, lower-ABV request).
- Positive/negative recommendation feedback.

Rules:
- Explicitly stated preferences outrank inferred preferences.
- Inferred preferences carry confidence and decay over time.
- A one-off edit is not treated as a permanent preference.
- Users can inspect, correct, reset, and delete their taste profile.
- Personal profiles are not included in commercial or general aggregate exports.

### B. Aggregate Discovery Intelligence (internal)

Purpose: identify broad areas of curiosity and unmet educational needs.

Examples:
- Frequently explored ingredients and flavor families.
- Common questions about spirits, wine regions, production, or cocktail techniques.
- Topics with high search volume but low answer satisfaction.
- Recipe adjustment patterns, aggregated without linking them to individuals.
- Menu categories and beverage styles encountered in observations.

Rules:
- Only include events covered by the user's aggregate-research consent.
- Apply minimum cohort thresholds before showing a segment.
- Suppress rare combinations and small geographies that could identify a person.
- Never expose raw consumer text in an aggregate dashboard.

### C. Harmony Knowledge-Gap Intelligence (internal)

Purpose: identify where Harmony needs better evidence or coverage.

Examples:
- Repeated unanswered questions.
- Repeated low-confidence menu-item resolution.
- Missing producer, region, ingredient, or production details.
- Contradictory claims across sources.
- Journey sections with poor helpfulness feedback.

Output is a prioritized research queue, not an automatic database update.

### D. Experience Quality Intelligence (internal)

Purpose: improve Discover and Harmony Journeys.

Examples:
- Scan completion and extraction correction rates.
- Time to first useful Journey.
- Journey section helpfulness.
- Search reformulations and unresolved intents.
- Repeated navigation friction or feature abandonment.

Do not interpret time-on-screen as quality by itself. Use explicit feedback and task completion alongside behavioral metrics.

## 4. Event taxonomy

All events use a versioned envelope. Suggested fields:

```ts
interface LearningEvent {
  eventId: string;                 // random UUID; idempotency key
  eventName: string;               // allow-listed event name
  schemaVersion: number;
  occurredAt: string;              // ISO-8601 UTC
  anonymousSubjectId?: string;     // scoped pseudonymous ID
  accountId?: string;              // internal reference only; never exported
  sessionId?: string;              // short-lived, rotating session ID
  appVersion: string;
  platform: 'ios' | 'android';
  consentSnapshot: {
    personalization: boolean;
    aggregateResearch: boolean;
    conversationAnalysis: boolean;
    policyVersion: string;
  };
  context?: {
    beverageCategory?: 'cocktail' | 'wine' | 'beer' | 'spirits' | 'other';
    feature?: string;
    venueRegion?: string;          // coarse region only, optional
    sourceType?: 'menu_scan' | 'search' | 'journey' | 'collection' | 'remix';
    entityIds?: string[];          // internal IDs; not names of private entities
  };
  properties?: Record<string, string | number | boolean | string[]>;
}
```

Do not put free-text questions, exact GPS, email, phone number, full IP address, or raw photo URLs in the general event envelope.

### Initial allow-listed events

| Event | Meaning | Learning use |
|---|---|---|
| `scan_started` | User began a menu scan | Scan UX funnel |
| `scan_completed` | User completed capture | Capture success |
| `extraction_corrected` | User corrected extracted content | OCR/extraction quality |
| `menu_item_opened` | User opened a detected item | Category curiosity |
| `journey_started` | User requested a Journey | Education demand |
| `journey_feedback_submitted` | User rated usefulness | Content quality |
| `question_intent_selected` | User chose a question topic | Topic demand |
| `question_submitted` | User sent a free-text question | Only conversation-analysis consent; store separately |
| `item_saved` | User saved an item | Personal collection behavior; aggregate only with consent |
| `remix_created` | User created a recipe variant | Creative engagement |
| `remix_adjustment_made` | User changed a recipe attribute | Formulation interest |
| `recommendation_feedback` | User liked/disliked a recommendation | Relevance learning |
| `search_no_result` | Search found no useful match | Knowledge-gap detection |
| `entity_match_rejected` | User rejected a proposed entity match | Resolution quality |
| `content_reported` | User flagged inaccurate or inappropriate content | Safety/quality review |

Avoid logging every tap. Events must map to a named product question or quality metric.

## 5. Consent and data separation

Present three independent controls in plain language:

1. **Personalization:** "Use my activity to improve recommendations and my taste profile."
2. **Help improve Harmony:** "Allow de-identified activity to help improve Harmony's beverage knowledge and features."
3. **Analyze my questions:** "Allow my questions to be analyzed to identify topics Harmony should explain better."

Defaults should be conservative and comply with applicable platform and privacy requirements. Do not bundle consent or use a preselected checkbox. Record consent version, timestamp, source, and withdrawal timestamp.

### Data zones

- **Private account zone:** profile, taste settings, saved items, private notes, personal recipe versions.
- **Raw event zone:** minimal pseudonymous event records with short retention and strict access controls.
- **Question vault:** separately permissioned text, redaction pipeline, restricted reviewer access, short retention.
- **Aggregate zone:** thresholded statistics with no direct identifiers or raw text.
- **Learning queue:** hypotheses and tasks referencing aggregate evidence and approved source material, not consumer identities.

Consent withdrawal must stop future processing for that purpose and trigger the defined deletion or de-identification workflow for eligible historical records. Deletion must propagate to derived personal profiles and raw event/question stores where applicable. Keep only legally required minimal audit records.

## 6. Trend detection and interpretation

A trend candidate should not be raised solely because an item has many clicks. Score it across:

- **Volume:** number of distinct consenting users or sessions.
- **Growth:** change against a seasonally appropriate baseline.
- **Breadth:** number of independent venues, regions, and sessions represented.
- **Persistence:** whether the signal continues over multiple windows.
- **Confidence:** data quality, extraction confidence, and taxonomy mapping quality.
- **Actionability:** whether a specific Harmony capability can respond.
- **Bias risk:** likely sampling bias, campaign effects, or overrepresentation.

Example candidate score (initial heuristic, calibrate after pilot):

`priority = 0.20*volume + 0.20*growth + 0.15*breadth + 0.15*persistence + 0.15*confidence + 0.15*actionability - bias_penalty`

Normalize component scores to 0–1. This score prioritizes human review; it is not a scientific claim or a measure of consumer preference.

### Trend lifecycle

`signal_detected` → `candidate_created` → `quality_checked` → `human_review` → `research_requested` → `evidence_collected` → `improvement_proposed` → `approved` → `implemented` → `outcome_measured`.

Alternative terminal states: `rejected`, `insufficient_evidence`, `duplicate`, `expired`.

Each candidate stores:
- Hypothesis and plain-language interpretation.
- Time window and comparison baseline.
- Cohort size and breadth indicators.
- Consent eligibility and privacy-threshold result.
- Known sampling/bias caveats.
- Supporting aggregate metrics.
- Research links and evidence quality.
- Proposed Harmony subsystem and owner.
- Decision, reviewer, implementation version, and outcome.

## 7. How signals improve Harmony systems

| Harmony system | Learning signal | Controlled improvement |
|---|---|---|
| Journeys | Repeated questions, low helpfulness, abandoned sections | Improve explanations, sequencing, depth, and source coverage |
| Cocktail Generator | Remix edits, substitutions, feedback | Improve role-aware recipe suggestions and formulation guidance |
| Flavor Intelligence | Ingredient/flavor exploration and pairing questions | Prioritize sourced pairing research and taxonomy gaps |
| Wine Intelligence | Region/grape/producer questions and failed resolutions | Expand verified regional and producer coverage |
| Menu Intelligence | Scan observations, corrections, venue confirmations | Improve extraction, normalization, matching, and freshness |
| Harmony Reason | Repeated uncertainty and source conflicts | Improve evidence retrieval, confidence handling, and abstention |
| Discover UX | Funnel friction, errors, feedback | Improve capture, navigation, and time-to-value |

A learning task must name the exact target: taxonomy, source coverage, extraction model, matching rule, Journey template, recipe constraint, or UX component. "Improve AI" is not an actionable task.

## 8. Cocktail-specific learning rules

- Treat a recipe remix as a user-created variant, never as evidence that the venue's original recipe is wrong.
- Track adjustment intent separately from ingredient quantities (e.g. `less_sweet_requested` does not establish a target Brix).
- Do not infer pH, titratable acidity, Brix, dilution, ABV, or molecular aroma compounds from a drink name or a qualitative preference.
- Flavor taxonomy signals can prioritize research but do not establish chemical composition.
- Canonical cocktail specs remain distinct from menu-observed recipes and user-created versions.

## 9. Suggested isolated development schema

These are proposed Discover-owned tables, not production changes:

- `learning_consent_records`
- `learning_events`
- `learning_question_records`
- `personal_taste_profiles`
- `personal_taste_signals`
- `learning_aggregate_metrics`
- `learning_trend_candidates`
- `learning_research_tasks`
- `learning_improvement_proposals`
- `learning_outcome_measurements`

Key constraints:
- All event writes are idempotent on `event_id`.
- Every event has `schema_version` and `occurred_at`.
- Consent is checked server-side at ingestion and again before aggregation.
- Raw event data is not directly accessible to mobile clients or commercial-facing interfaces.
- Personal tables use owner-scoped authorization.
- Aggregates enforce minimum cohort thresholds in the query/service layer and database layer where feasible.
- No production service-role key or production write credential is used by Discover.

## 10. Internal Learning Console

Build an internal-only console after the event pipeline is proven. Initial views:

1. **Signal health:** event volume, consent coverage, schema failures, duplicate rate, retention/deletion job health.
2. **Consumer curiosity:** top question intents, categories, ingredient/flavor themes, and growth over time (thresholded).
3. **Knowledge gaps:** unresolved questions, low-confidence matches, missing evidence, repeated corrections.
4. **Recipe learning:** aggregate remix intent and adjustment patterns, without personal histories.
5. **Journey quality:** usefulness ratings, completion, section feedback, and unresolved intent.
6. **Improvement queue:** candidates, evidence, owner, status, decision, and measured result.

No raw consumer-level timeline should appear in the console. Reviewers see only the minimum data necessary for a specific support or quality task.

## 11. Metrics

### Product and learning metrics
- Scan-to-useful-Journey conversion.
- First useful answer latency.
- Journey helpfulness rate.
- Question resolution rate.
- Search no-result rate.
- Extraction correction rate.
- Entity match acceptance rate.
- Repeat use for education/collection purposes (not alcohol consumption frequency).
- Number of validated knowledge gaps closed.
- Improvement adoption rate.
- Post-change quality lift versus baseline.

### Data quality and privacy metrics
- Event schema validity.
- Duplicate/idempotency rejection rate.
- Consent-check failure rate (target zero accepted events without valid purpose consent).
- Percentage of aggregate reports meeting cohort thresholds.
- Deletion/withdrawal completion time.
- Raw question redaction success and reviewer access audit coverage.
- Retention policy compliance.

Do not optimize for drinks consumed, alcohol purchase volume, or frequency of drinking.

## 12. MVP delivery sequence

### Phase 0 — Contract and governance
- Finalize event dictionary and schema versioning.
- Define consent copy and policy versioning.
- Set retention, deletion, and access-control policies.
- Define aggregate thresholds and geographic granularity.
- Threat-model the event and question stores.

### Phase 1 — Minimal event capture
- Implement server-side event ingestion in isolated Discover backend.
- Add idempotency and allow-list validation.
- Capture a small set: scan started/completed, extraction corrected, Journey started/feedback, item saved, remix created, search no result.
- Keep free-text question analysis off until separate consent and redaction are implemented.

### Phase 2 — Personal learning
- Add explicit taste profile controls.
- Distinguish explicit preferences from inferred signals.
- Add confidence, decay, explainability, reset, and deletion.
- Validate recommendations with user feedback.

### Phase 3 — Aggregate learning
- Build thresholded aggregate jobs.
- Create initial trend candidates and knowledge-gap queue.
- Add bias and quality checks.
- Human review only; no automatic canonical changes.

### Phase 4 — Improvement loop
- Connect approved research tasks to relevant Harmony development workflows through controlled adapters.
- Track implementation versions and before/after outcomes.
- Add internal console.

## 13. MVP acceptance criteria

The Learning Engine MVP is not complete until:
- No event is accepted for an optional purpose without valid consent for that purpose.
- Event ingestion is idempotent and schema-versioned.
- Personal taste records cannot be read by other users or aggregate consumers.
- Aggregate reports cannot display cohorts below the configured threshold.
- Free-text questions are not used for aggregate analysis without separate consent and redaction.
- A consumer can withdraw consent and request deletion through a documented workflow.
- Every trend candidate includes caveats and evidence metadata.
- No trend candidate can directly mutate canonical Harmony knowledge.
- Every accepted improvement has an owner, approval, version, and outcome metric.
- Production Harmony remains read-only throughout this development phase.

## 14. Explicit non-goals

- Selling or licensing individual consumer data.
- Exposing identifiable drinking histories to brands, venues, or other customers.
- Automatically changing canonical recipes or research facts based on popularity.
- Inferring health, addiction, income, or other sensitive traits.
- Optimizing alcohol consumption or purchase frequency.
- Treating raw menu photos as verified canonical menus.
- Copying production data into Discover without authorization and a documented data-minimization review.

## 15. First implementation backlog

| Priority | Work item | Deliverable |
|---|---|---|
| P0 | Event contract | Typed event schema and allow-list |
| P0 | Consent model | Versioned consent records and server-side enforcement |
| P0 | Isolated ingestion | Authenticated, idempotent event endpoint |
| P0 | Data separation | Private profile, raw event, question, and aggregate zones |
| P1 | Initial event instrumentation | Scan, extraction correction, Journey, save, remix, search events |
| P1 | Personal taste profile | Explicit preferences and reversible inferred signals |
| P1 | Aggregate jobs | Daily/weekly thresholded metrics |
| P1 | Knowledge-gap queue | Human-reviewed trend/research candidates |
| P2 | Internal console | Signal health and improvement queue |
| P2 | Outcome measurement | Before/after quality measurement |
| P3 | Question analysis | Separate opt-in, redaction, restricted analysis pipeline |

## 16. Implementation boundary and current status

**Status checked:** 21 Nov 2026, read-only, against the Discover development database and the `main` branch. Production Supabase was not touched.

**In short:** the P0 plumbing (event contract, consent records, ingestion endpoint, data separation) and the 13-month clean-up are built and live in Discover development. Nothing in the app sends events or asks for learning consent yet, so every learning table is empty. P1–P3 (instrumentation, taste profiles, aggregate jobs, knowledge-gap queue, console, outcome measurement, question analysis) are code-only or not started. Existing production Supabase remains read-only; obtain explicit authorization before any production write, migration, function deployment, policy, or configuration change.

### What is built, checked against what is live

| Spec item | Built? | Where | Live check (21 Nov 2026) |
|---|---|---|---|
| Event contract & allow-list (P0) | Yes | `packages/shared-types/learning-events.ts`, `packages/learning-engine/ingest-policy.ts`, tests in `tests/learning-ingest-policy.test.ts` | Code only; used by the ingestion endpoint |
| Consent model (P0) | Yes (server) | Migrations `0003`, `0004` (`learning_set_consent`, `learning_current_consent`) | `learning_consent_records`: 0 rows. Consent functions run as owner and cannot be called by visitors or signed-in users directly |
| Ingestion endpoint (P0) | Yes | `discover-api` function: `GET/PUT /v1/learning/consent`, `POST /v1/learning/events` (`apps/edge/router.ts`) | `discover-api` is deployed and active. Requires a signed-in user, rate-limited, size-limited, idempotent via `learning_ingest_event` |
| Data separation (P0) | Yes | Separate tables for events, questions, taste profiles, trends, research tasks, proposals, outcomes | All 8 learning tables have row-level security on. 7 have no client policies (server only). `personal_taste_profiles` lets a signed-in user read/insert/update only their own row. Visitors and signed-in users cannot delete or truncate any of them |
| Spec tables `personal_taste_signals`, `learning_aggregate_metrics` | **No** | — | Not created |
| Export & deletion requests | Yes | Migration `0007` (`learning_deletion_requests`) | 1 row; server only |
| Raw-event retention (13 months) | Yes | Migration `0008` (`discover_purge_learning_events`), `discover-retention` function | Daily job `discover-retention-daily` (09:17 UTC) last ran 21 Nov 2026, succeeded; nothing to delete |
| Event instrumentation in the app (P1) | **No** | — | No app screen calls `/v1/learning/*`; `learning_events`: 0 rows |
| Consent screen in the app (P0/P1) | **No** | — | No learning consent UI. (The bartender-voice consent panel is a different consent.) |
| Personal taste profile (P1) | Table only | `personal_taste_profiles` | 0 rows; nothing writes to it |
| Aggregate jobs (P1) | **No** | — | No timed job builds aggregates |
| Knowledge-gap / trend logic (P1) | Code only | `packages/learning-engine/knowledge-gap-engine.ts`, `trend-evaluator.ts`, `improvement-workflow.ts` + tests | Not wired to any job or endpoint; `learning_trend_candidates`, `learning_research_tasks`, `learning_improvement_proposals`: 0 rows |
| Internal console (P2) | Mock-up only | `app/learning-console.tsx` (sample data) | Hidden from production builds (developer-only screen list) |
| Outcome measurement (P2) | Table only | `learning_outcome_measurements` | 0 rows |
| Question analysis (P3) | Table only | `learning_question_records` | 0 rows; the endpoint refuses question text |

### Related but separate

The scanner's own research loop (`discover_research_outcomes`, `discover_research_hints`, nightly job `discover-propose-research-hints`) is live and holds data. It learns from scan results, not from consumer events, and does not use the consent model above.

### What depends on it

- **App:** nothing yet. No screen sends learning events or reads a taste profile, so turning the engine off would not change what users see today.
- **Backend:** the `discover-api` function hosts the learning endpoints; the `discover-retention` function and its daily job purge old raw events.
- **Future work that will depend on it:** personal recommendations (Taste), the Learning Console, and any aggregate "what people are curious about" reporting.

### Known loose end

`apps/api/src/routes/learning.ts` (the older local Node server) writes consent and events straight into the tables instead of using the consent-checked database functions that the deployed `discover-api` uses. It is not deployed, but it should be removed or aligned before anyone runs that server against real data.
