# Discover Research Engine — implementation specification

Status: design/specification branch. No production deployment or database writes.

## Purpose
Add asynchronous, evidence-led product research to Harmony Discover. This is separate from the fast visual recognition path and separate from the existing Harmony Journeys production implementation.

## Non-negotiable boundaries
- All implementation, secrets, storage, usage accounting, and configuration belong to the Discover DEV Supabase project.
- Do not call or expose Harmony PHG production research RPCs or Edge Functions from Discover.
- Do not alter the main Harmony PHG database, existing Journeys functions, or their secrets.
- Never put Anthropic/provider keys in the client.
- Recognition must return without waiting for web research. Research is queued/background work.
- Do not merge or deploy without review and explicit approval.

## Two independent confidence dimensions
1. Identification confidence: confidence that the image corresponds to the exact brand + product + expression/SKU/vintage/size.
2. Evidence confidence: strength and coverage of the sources supporting each individual claim.
Never average these into one number. A highly researched wrong match remains a wrong match.

## Pipeline
1. **Capture and parse:** OCR/vision extracts candidate brand, product name, expression, category, vintage, ABV/proof, volume, barcode, label identifiers, producer/site, and visible distinguishing marks.
2. **Candidate resolution:** search the Discover DEV product catalog and normalized aliases; use barcode/GTIN when present; compare label tokens, category, ABV, volume, vintage and expression. Return ranked candidates plus explicit ambiguity.
3. **Fast response:** return best candidate, alternatives, identification confidence, and missing/uncertain fields. Target sub-second recognition is a product goal, not a guarantee of the research path.
4. **Research enqueue:** enqueue only when product identity clears a configurable threshold or user explicitly requests research. Deduplicate by canonical product identity + profile version.
5. **Profile selection:** choose category-specific weighted questions from the local config. Refine profile by subtype (e.g. bourbon vs rye; Cognac vs pisco; Champagne vs tank-method sparkling).
6. **Search:** perform bounded web search in a server-side function. Query primary producer technical sheets and official product pages first, then regulators/appellation bodies, then recognized trade/reference sources.
7. **Claim extraction:** each proposed fact is an individual claim with topic, value/text, source URL, source title/domain, retrieval timestamp, and evidence excerpt or reference.
8. **Validation:** accept only claims whose source URL was actually returned/fetched in this run; validate URL, topic, non-empty claim, and source relevance. Detect conflicting values and retain both with conflict status. Do not infer absent values.
9. **Persistence:** store product identity, claims, sources, research run metadata, profile version, model/provider version, cost, and status in Discover DEV only.
10. **Cache and refresh:** reuse verified claims; search only missing, stale, or disputed fields. Store claim-level fetched_at and optional expires_at.
11. **Journeys handoff:** future, separately approved bridge may pass approved, source-backed claims into Journeys. No bridge in this phase.

## Search policy
- Brand and exact expression are separate research targets.
- Search product-specific terms before broad brand searches.
- Use category-specific query templates, not a single generic prompt.
- Search official producer pages, technical sheets, regulator specifications, appellation/PGI/PDO/COLAs, and recognized trade sources.
- Each accepted claim must cite an exact source URL retrieved in the current search or an explicitly revalidated cached source.
- Keep source records separate from claims so one source can support multiple facts and facts can have multiple sources.
- Search budget defaults should be configurable per category and per product; start conservatively and meter actual provider usage. Journeys' historical caps are reference values, not Discover production budgets.
- Do not use search result ranking as truth. Prefer primary sources and retain provenance.

## Initial profile coverage
Seed the 17 profiles in `journeys-research-profiles.reference.json` as a starting library. Add SKU/identity fields and category subtypes; do not blindly reuse Journeys' story-score weighting for product correctness.

Required Discover-specific refinements:
- American whiskey: bourbon, rye, wheat whiskey, Tennessee whiskey, bottled-in-bond, single barrel, barrel proof, limited release.
- Scotch/Irish/world whisky: country/region, single malt/blended/grain, distillery, age statement, cask/finish, batch and bottling.
- Brandy: Cognac cru/age class, Armagnac, Calvados, pisco denomination/type, grappa/pomace.
- Wine: red/white/rosé/orange/sparkling/fortified, appellation, producer, cuvée, vintage, grape blend, bottle format.
- Beer: style, brewery, exact beer/SKU, ABV, package format, seasonal/release, hop/malt/yeast facts where disclosed.
- Non-alcoholic beer: explicitly separate NA/low-alcohol classification and ABV threshold; do not assume from package color or branding.
- Kegs: distinguish beer identity from keg size/type, deposit/asset identifier, coupler and package metadata. Keg appearance alone is not product identity.
- Mixers and liqueurs: named flavor/variant, size, formulation version where published.

## Data model proposal (Discover DEV only)
- `research_products`: canonical product id, brand, product name, expression, category, subtype, vintage, ABV, volume, GTIN, producer, identity status.
- `research_aliases`: product id, normalized alias, alias type, locale, source.
- `research_runs`: product id, status, profile key/version, provider/model, started/finished, search count, token/cost usage, error, dedupe key.
- `research_sources`: canonical URL, normalized URL, title, domain, publisher type, retrieved_at, last_verified_at, source status.
- `research_claims`: product id, topic, claim text/value, normalized value, confidence, verification status, conflict group, created/updated.
- `research_claim_sources`: claim id, source id, supporting excerpt/reference, relation (supports/contradicts/context).
- `research_profile_versions`: profile key, version, JSON profile, active flag, created_at.
- `research_usage_daily`: provider, function, date, requests, tokens, spend, cap.
Use migrations with RLS and service-role-only writes. Public clients should receive only approved product facts through the existing Discover API authorization pattern.

## Claim statuses
- `verified_primary`: supported by a relevant primary source.
- `verified_secondary`: supported by a credible secondary source.
- `conflicting`: credible sources disagree; preserve both.
- `unverified`: plausible but insufficient evidence; not presented as fact.
- `not_disclosed`: source explicitly says it is not disclosed.
- `not_found`: bounded research found no reliable disclosure; not equivalent to secret.
- `stale`: previously supported but due for revalidation.

## Scoring
Identification score is computed from exact product name/expression, barcode, vintage, ABV, volume, label identifiers and producer match. It is calibrated against labeled test examples.
Evidence score is claim-level and source-level, based on primary/secondary source type, directness, freshness, agreement and completeness. Report coverage separately from confidence.
Journeys' age/protected-origin/story score may be retained only as an optional editorial/story score; it must not affect identification or evidence confidence.

## Test plan / release gates
- Golden set: at least 100 images across spirits, wine, beer, NA beer, mixers and kegs, with multiple expressions/vintages/SKUs per brand.
- Include near-duplicate labels, label redesigns, glare, low light, partial crops, rotated images, small text, and back labels.
- Measure exact-product top-1/top-3 accuracy, false confident match rate, field-level precision/recall, source validity rate, contradiction detection, latency, and cost per completed research.
- Require high-confidence false match rate to be extremely low; abstention/clarification is preferable to confident misidentification.
- Verify the fast recognition endpoint does not wait on web search.
- Verify repeated scans reuse cached research and do not incur duplicate search spend.
- Verify unauthenticated clients cannot invoke internal research or read unapproved claims.
- Do not deploy until tests, RLS review, usage caps, and secret handling are checked.

## Build sequence
1. Normalize reference profiles and version them locally in Discover.
2. Add Discover DEV schema/migrations for products, sources, claims, runs, usage, and profiles.
3. Implement server-only research worker and queue/deduplication.
4. Add claim/source validation and cache reuse.
5. Add UI display of verified facts, provenance, uncertainty, and conflicts.
6. Run golden-set evaluation and cost/latency tests.
7. Only then propose a separately approved Journeys handoff.
