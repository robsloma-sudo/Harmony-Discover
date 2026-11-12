# Discover bottle recognition and research integration audit

Date: 2026-11-12
Scope: read-only review of Harmony-Discover `main` source files. No production code or database was changed.

## Executive finding

Discover already has a live bottle-label reader and a save-time research enrichment path in `supabase/functions/discover-live-read/index.ts`. Research is not invoked during every camera frame; it is invoked only after explicit save. This is a good latency boundary.

However, the current enrichment path is not yet equivalent to the evidence validation in Harmony Journeys. The most important issue is that model-returned source URLs are accepted if they are HTTPS, without checking that those URLs were actually returned by the web-search tool or fetched and inspected. A model confidence threshold is applied, but it is not a substitute for provenance validation.

The current product matcher also appears to be unable to return an exact product match for the seeded brand-only catalog records because the matching response is accepted only when product and category are populated.

## Files reviewed

- `supabase/functions/discover-live-read/index.ts`
- `apps/edge/discover-api.ts`
- `supabase/migrations/20261111154341_discover_bottle_sightings_and_product_matcher.sql`
- `supabase/migrations/20261111154707_discover_bottle_sightings_label_details.sql`
- `supabase/migrations/20261111162902_discover_bottle_scan_global_cap_lock.sql`
- `supabase/migrations/20261111170433_discover_product_index_brand_seed.sql`
- `src/services/bottleObservation.ts`
- `src/services/bottleInventory.ts`
- `src/services/scannerCapabilities.ts`

## Existing request flow

### Live frame path

1. Authenticates the bearer token with Supabase Auth.
2. Enforces the Discover DEV project reference at runtime.
3. Checks the request origin and payload size.
4. Applies a per-user minute rate limit and daily per-user/project frame caps.
5. Sends the image to Anthropic using a structured `bottles` tool schema.
6. Extracts brand, product/expression, category, proof, size, vintage and many other label fields, with per-field confidence.
7. Calls `discover_match_products` for fuzzy catalog matching.
8. Returns bottle observations and any visible menu items.
9. Does not run web research in this path.

### Explicit save path

1. Requires a scan session UUID and rate-limits saves.
2. Accepts only bottles with a readable brand and label confidence at or above 0.65.
3. Enriches at most five bottles per save.
4. Runs up to four web-search tool uses per bottle through Anthropic.
5. Asks for missing fields only; the model is instructed not to overwrite label-read facts.
6. Accepts returned fields only when they are in the missing-field allowlist and model confidence is at least 0.78.
7. Re-runs product matching on the server; does not trust browser-supplied product IDs.
8. Saves a sighting to `bottle_sightings`, including research details, field confidence and source records embedded in `label_details` JSON.

## Findings and severity

### P0 — Research source URLs are not verified against actual search results

In `researchBottle`, the model is given Anthropic's `web_search_20250305` tool and asked to return source URLs. The returned source records are filtered by HTTPS syntax only. The code does not:
- collect the URLs in `web_search_tool_result` blocks;
- require each submitted source URL to be in those results;
- fetch and inspect the source page;
- prove that a cited source supports each specific field;
- reject a source whose URL is unrelated to the exact product expression.

This means a plausible-looking but fabricated, unrelated, or non-retrieved URL can be stored alongside a researched fact. Do not present these sources as verified citations until this is fixed.

**Required fix:** mirror Journeys' provenance discipline: collect exact web-search result URLs from tool-result blocks, normalize URLs consistently, and accept a claim only when its source is in the current search result set (or has been explicitly revalidated). Prefer a second verification pass for critical legal/technical facts. Persist claim-to-source support links rather than trusting free-form model assertions.

### P1 — Product matcher is brand-seeded but exact-product-gated

The base `product_index` schema permits nullable `product` and `category`. The reproducible brand seed migration inserts brand-only rows. The live reader accepts a match only if the result has:
- exact normalized brand agreement;
- a non-null product;
- a non-null category;
- fuzzy score >= 0.72.

Therefore, brand-only seed rows cannot become accepted matches. This is logically consistent with refusing to claim an exact SKU from a brand-only row, but it means those seed rows are recall hints, not confirmed product catalog entries.

**Required fix:** explicitly distinguish `brand_candidate`, `product_candidate`, and `verified_product` states. A brand-only row may suggest a brand, but it must never be returned as an exact product match. Add product/expression/size/proof/vintage/GTIN records before enabling exact match status.

### P1 — Search cost and fan-out are higher than the Journeys pattern

The current save path runs research for up to five bottles in parallel, with up to four search-tool uses per bottle. The theoretical ceiling is 20 web-search uses per save request, before token costs. There is no category-specific search profile, no configurable per-subject budget, and no deduplication/cache check in the reviewed function.

**Required fix:** introduce per-category profiles and a strict budget gate before calling the provider. Deduplicate by canonical product identity + profile version. Search only missing/stale/contested facts. Consider one or two searches for initial high-value fields, then targeted follow-up only when justified. Track actual provider usage and stop when the budget is exhausted.

### P1 — Research profiles are not category-specific

The current query uses brand, product, category, proof and size, but the same generic missing-field list and research prompt are used across all beverage categories. The prompt says exact expression, but it does not prioritize the different evidence that matters for bourbon, Cognac, wine vintage, beer style, NA beer, or keg identity.

**Required fix:** port the 23 live Journeys profiles as a reference library into Discover-owned configuration. Adapt them to SKU identification and factual verification, not Journeys' editorial story score. Add explicit profiles for package identity and product subtypes.

### P1 — Research provenance is stored as opaque JSON

Research fields, confidence values and source objects are embedded inside `bottle_sightings.label_details`. This is convenient for a prototype but poor for reuse, conflict handling, source revalidation, queryability, and product-level caching.

**Required fix:** normalized Discover DEV tables for canonical products, research runs, sources, claims, claim-source links, profile versions, aliases, and usage accounting. Keep the original observation as an immutable record of what the camera saw; research claims should be separate reusable records.

### P2 — Research field confidence is model-assigned

A threshold of 0.78 is applied to model-returned confidence. This measures the model's self-assessment, not calibrated evidence strength. It does not encode source type, directness, source-product identity match, independent corroboration, or contradictions.

**Required fix:** retain model confidence as one signal, but calculate evidence status separately from provenance, primary/secondary source class, directness, freshness, exact-expression match, and corroboration. Keep conflicts visible.

### P2 — Save operation couples persistence to synchronous research

The save handler performs all enrichment before inserting sighting rows. That means the user save response waits for all selected research calls, and an upstream slow or hanging request may delay persistence. The current provider fetch has no explicit AbortSignal timeout in `researchBottle`.

**Required fix:** persist the sighting promptly, enqueue research in a separate server-side job/queue, return the saved observation and research status immediately, and update research results asynchronously. Set explicit provider timeouts and bounded concurrency.

### P2 — Existing identity confidence is not a calibrated exact-SKU score

The vision reader emits confidence per field and the fuzzy product matcher returns a score. These are useful signals, but neither is calibrated probability that a particular expression/SKU/vintage is correct. The code correctly avoids treating fuzzy brand similarity alone as proof, but it has no candidate ranking or explicit ambiguity protocol for near-identical products.

**Required fix:** candidate resolution should compare brand, expression, producer, category/subtype, ABV/proof, volume, vintage, package type, label identifiers and barcode. Return alternatives and abstain when evidence cannot separate them. Evaluate against labeled image examples.

### P2 — Bottle-volume observations are deliberately separate from product recognition

`src/services/bottleObservation.ts` explicitly says it does not inspect pixels, assign product identity, or prove that a profile matches a SKU. It requires a supplied calibrated profile and only marks identity verified when a verified SKU ID is passed in. This is an appropriate safety boundary; do not infer metric geometry or inventory identity from the label reader alone.

## Recommended target architecture

- **Fast recognition:** image -> label transcription -> candidate ranking -> confidence/alternatives. No web research on the frame path.
- **Immediate save:** save the physical observation and raw extracted label facts.
- **Async research queue:** enqueue only sufficiently identified products or user-requested research.
- **Profile-driven research:** select the category/subtype profile, search exact missing facts, and enforce spend caps.
- **Evidence validation:** verify source URLs against actual search results, map each claim to its sources, retain conflicts and provenance.
- **Normalized storage:** product-level claims and source records are reusable across sightings.
- **Presentation:** show what was read from the label separately from what was researched; expose evidence status and sources.
- **Future Journeys handoff:** only through a separately approved, narrowly scoped bridge. No direct calls from Discover to Harmony production functions.

## Implementation order

1. Fix search-result URL provenance validation in the existing research path or its replacement.
2. Move research out of the synchronous save request into an asynchronous worker.
3. Add a Discover-owned category/subtype profile registry, starting from the 23 Journeys reference profiles.
4. Add research run/source/claim tables and deduplication.
5. Separate brand candidates from exact product/SKU records.
6. Build a labeled golden set and calibrate identification confidence.
7. Add NA beer and keg-specific identity rules.
8. Evaluate latency, accuracy, false confident matches, source validity, cost per product and cache hit rate.

## Guardrails

- This audit is based on source files on GitHub `main`; it is not a live production runtime test.
- No changes were made to Supabase, Netlify, Harmony PHG production, or Harmony Journeys.
- No research function or migration was deployed.
- PR #24 remains a documentation-only draft; this audit should be reviewed before implementation work begins.
