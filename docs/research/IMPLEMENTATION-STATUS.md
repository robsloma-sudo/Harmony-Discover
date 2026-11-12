# Discover research engine — implementation status

Updated: 2026-11-12

## Implemented on this feature branch (not deployed)

The existing `discover-live-read` save-time research path now has a first provenance-validation improvement:

- Extracts URLs only from Anthropic `web_search_tool_result` blocks.
- Handles Anthropic `pause_turn` continuations (up to three model turns), accumulating tool results before processing the final structured research response.
- Normalizes HTTPS URLs by removing query/hash components while preserving case-sensitive paths.
- Rejects source URLs that were not actually returned by web search.
- Requires field-level `supports` mappings and accepts only mappings to currently missing/allowed fields.
- Accepts a researched field only when it has at least one accepted source mapping and passes the existing model-confidence threshold.
- Uses the title returned by web search rather than trusting the model-supplied title.
- Adds a 35-second request timeout and fails closed to an empty enrichment result on timeout/provider errors.
- Adds unit tests for URL normalization, search-result extraction, fabricated URL rejection, and field mapping.

Files:
- `supabase/functions/discover-live-read/index.ts`
- `supabase/functions/discover-live-read/researchEvidence.ts`
- `tests/research-evidence.test.ts`

## Not yet implemented

- Research is still synchronous inside the save action; asynchronous queue/worker remains next.
- Existing enrichment still allows up to five bottles per save and up to four web-search uses per bottle. A central category-based budget and deduplication/cache are not implemented.
- Research results are still stored inside `bottle_sightings.label_details` JSON, not normalized product-level claims and sources.
- Category-specific Journeys-derived profiles are documented and extracted but not yet wired into the reader.
- Product candidate ranking and calibrated exact-SKU confidence are not implemented.
- No golden-set evaluation has been run.

## Verification and deployment status

- Changes are committed to `feat/discover-research-engine-spec-2026-11-12`, which is the head branch for draft PR #24.
- No GitHub Actions workflow run was returned for the latest commit at the time of this update. Therefore tests have **not** been independently confirmed as passing.
- No Supabase migration has been applied.
- No Edge Function has been deployed.
- No Netlify deployment has been triggered.
- Main Harmony PHG production and Harmony Journeys production remain untouched.


## Asynchronous queue implementation added (not deployed)

The next implementation slice is now committed:

- Adds `bottle_research_jobs`, a durable queue keyed uniquely to each saved bottle sighting.
- Adds an atomic `SKIP LOCKED` claim RPC with stale-worker recovery, attempt limits, and exponential retry delay.
- Changes bottle save to insert sightings first, then enqueue up to five research jobs. The camera save response no longer waits for web research.
- Adds a dedicated `discover-research-worker` Edge Function, protected by `DISCOVER_RESEARCH_WORKER_SECRET`, that claims two jobs per invocation, searches, validates source provenance, and merges accepted facts back into the original sighting.
- Worker invocations chain in bounded batches when a batch is full, allowing a five-bottle save to drain without one long-running invocation.
- Research facts retain per-field confidence and source mappings in the existing `label_details` JSON structure.
- Failed work is retried with backoff; the queue is durable if an invocation terminates unexpectedly.

### Required Discover DEV secrets before deployment

- `DISCOVER_RESEARCH_WORKER_SECRET`: generate a high-entropy random secret and set the same value for both Edge Functions.
- Existing `ANTHROPIC_API_KEY` remains required by `discover-live-read`; the worker also reads it.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are the existing Discover DEV Edge Function secrets.

### Remaining safeguards before production use

- Add a project-wide daily research spend/search cap, not just per-save and per-invocation limits.
- Add cache/deduplication by normalized exact product identity.
- Add queue observability and a dead-letter review path.
- Add category profiles and the golden-set evaluation.
- Verify Edge Function typecheck/tests and exercise a real DEV queue round trip before enabling the worker secret.

No migration was applied. No Edge Function was deployed. No production Harmony PHG or Harmony Journeys resource was changed.


## Category profiles and daily budget controls added (not deployed)

- Added a Discover worker profile selector using the extracted 23-profile Journeys reference, bundled under `supabase/functions/_shared` so the Edge Function can import it at deploy time.
- Selects profiles by beverage category and whiskey subtype (American, Scotch/Irish, world whisky, with aged-spirit override).
- Injects the three highest-weight research dimensions into the exact-product research prompt; this is adapted for missing product facts, not the Journeys editorial story score.
- Search tool usage is now profile-bounded: one search use for generic spirit fallback, two for specific profiles.
- Added atomic daily reservation accounting in Discover DEV: default cap 5 jobs / 10 search units per consumer per UTC day, and 100 jobs / 200 search units project-wide per UTC day.
- Budget reservation is made before calling Anthropic. Exhausted jobs are deferred until the next UTC day without consuming their retry-attempt allowance.
- Queue draining now continues after any non-empty batch so multiple jobs enqueued by one save can be processed promptly.

### Remaining before enabling unattended research

- Add a scheduled DEV-only queue wake-up for retry/deferred jobs; current chaining drains immediately available work but does not wake the queue later on its own.
- Add provider-reported usage/cost reconciliation and a dead-letter/admin view.
- Add cache/deduplication by exact product identity and profile version.
- Add runtime tests and a real Discover DEV queue round trip.
- Review profile import/build behavior with the actual Supabase CLI before deployment.

No migration has been applied, no secrets have been set, and no function has been deployed.
