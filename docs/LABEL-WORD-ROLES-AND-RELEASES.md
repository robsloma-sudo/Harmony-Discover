# Label word roles and releases (Discover DEV, v0.1.0 — 2026-11-14)

## Why
The bottle reader was saving class/type statements as product names
("Buffalo Trace — Kentucky Straight Bourbon Whiskey"), and it could not tell one
release of a bottle from another (E.H. Taylor Barrel Proof is 127.3 proof in 2021,
2024 and 2025).

## Rule
A bottle's identity is **brand + line + release + size**. Every other word on the
label has a role and is kept as a fact, never as the name:

| role | examples | used for |
|---|---|---|
| brand | Colonel E.H. Taylor, Jr. | identity |
| line | Barrel Proof, Single Barrel, Cured Oak | identity |
| category | Kentucky Straight Bourbon Whiskey, bourbon, whiskey | PHG category |
| attribute | Bottled in Bond, Barrel Proof, Single Barrel, Small Batch | PHG attribute codes |
| producer_phrase / producer | Distilled, aged and bottled by / Old Fashioned Copper Distillery | fact |
| place, regulatory, descriptor | Frankfort KY, CA CRV, Government Warning, unfiltered | ignored for identity |
| numbers and codes | proof, ABV, size, age, barcode, laser lot code, DSP permit, label print code | facts / release |

A line name can also carry an attribute ("Barrel Proof" = cask strength).

## How the pieces decide
1. **Barcode** (valid GTIN check digit) → brand + line + size. Wins over words; disagreement is flagged.
2. **Label words** → brand, then that brand's line names (longest phrase first).
3. **Release** (only for lines with releases):
   proof must fit, and the laser lot year must fit (`L25295` = bottled 2025, day 295 = 22 Oct).
   One fit = matched. Several = ambiguous ("the laser code would settle it").
   None = `new_release_candidate` (never forced onto an old release).
4. Continuous lines (Single Barrel, Small Batch) have release `standard`; the lot code only dates the bottle.

## Database (Discover DEV `lqqmwqrffelgnbngrkep`, server-only)
- `phg_category_term_mirror` — read-only copy of PHG `category_terms` (321 rows, checksum-matched to PHG).
- `discover_label_terms` — phrase → role (+ PHG code). Seeds + rows rebuilt from the PHG copy
  by `discover_refresh_label_terms_from_phg()`. `discover_label_dictionary_problems()` lists any
  code that does not exist in the PHG mirrors (currently none).
- `discover_brand_lines`, `discover_line_barcodes`, `discover_line_releases` — lines, barcodes, releases,
  each with evidence (URLs or "observed on Rob's bottle").
- `discover_tag_label(text, brand_hint)` — word-role tagger.
- `discover_resolve_bottle(jsonb)` — `{brand, product, text, gtin, proof, size, lot_code, age}` →
  `{status, brand, line, release, size_ml, identity_key, reasons, flags, ...}`.
- `discover_identity_fixtures` + `discover_run_identity_fixtures()` — real-bottle tests.

## Tests (10/10 pass, ~5 ms per bottle)
Rob's three bottles (read 2026-11-14):

| bottle | barcode | laser code | result |
|---|---|---|---|
| Barrel Proof, 127.3 proof | 0 88004 00552 8 | L25295 → 22 Oct 2025 | 2025 release, 127.3 (retailers call it "Batch 16") |
| Single Barrel, BiB 100 proof | 0 88004 00551 1 | L25250 → 7 Sep 2025 | standard (continuous line) |
| Cured Oak, BiB 100 proof | 0 88004 02129 0 | L26085 → 26 Mar 2026 | 2026 release (10 years) |

Plus: Barrel Proof without a laser code stays ambiguous (3 releases); with an L24 code → 2024;
with an L26 code → new release candidate; Cured Oak without a code → ambiguous (2015 vs 2026);
reader fields only (brand + "Single Barrel") → matched; "Kentucky Straight Bourbon Whiskey" as a
product name is flagged as category words; barcode beats a misread line word.

## Not done yet
- Not wired into the live scanner or `discover-live-autosave` (next step: call
  `discover_resolve_bottle` before saving, and use `identity_key` instead of the old md5 key).
- Only E.H. Taylor lines are seeded. Other brands resolve to brand + category until their lines are added.
- Laser format is the Sazerac/Buffalo Trace `L+YY+DDD` one; other producers' codes are not parsed yet.
- Nothing is written to PHG. PHG `product_releases` is empty; `brand_lines` has 4 rows; PHG has two
  E.H. Taylor brand rows ("E. H. Taylor" with 4 products, "Colonel E.H. Taylor" with 0) and no Cured Oak
  product. These are proposals for Rob, not changes.
