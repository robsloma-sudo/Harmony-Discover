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
