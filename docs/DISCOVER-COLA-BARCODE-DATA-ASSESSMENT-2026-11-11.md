# Discover Live Read — COLA and barcode data assessment
Date: 2026-11-11
Scope: research and design only; no external dataset purchased or imported.

## Executive finding

The TTB Public COLA Registry is the authoritative source for US label-approval records, but it is a registry/search experience rather than a documented bulk product API. An independent service, COLA Cloud, has operationalized the public records into label images, OCR, extracted barcodes, category enrichment, an API, and a bulk-delivery option. It is the strongest immediate candidate for a controlled sample-based benchmark before deciding whether to license a full corpus.

## Source facts

### TTB Public COLA Registry
- Public, no registration or password required.
- Records include approved, expired, surrendered, and revoked COLAs.
- Electronic and paper label images are generally available for COLAs from 1999 onward; pre-1999 records expose data only.
- Pre-1996 searches may be incomplete.
- TTB says brand searches can miss results because of data-entry errors; permit-number searches can be a useful alternate.
- The registry contains approved labels, not rejected or returned applications. Public formula information is not available.
- Official TTB registry page: https://www.ttb.gov/online-services/public-cola-registry/
- Search page: https://www.ttbonline.gov/colasonline/publicSearchColasBasic.do

### COLA Cloud (independent, not TTB-endorsed)
- Its published 2005-forward export count is 2.72M COLA records and 5.18M label-image rows, with daily collection; counts are stated as of 2026-10-01.
- Its registry page currently states 590K+ distinct decoded barcode values, including QR codes; 544,337 are raw UPC/EAN values.
- It extracts barcodes from submitted label images and links detections to a TTB image record. It also provides OCR text, ABV, volume, origin/container signals, and normalized category enrichment.
- Self-service/API coverage is 2005-forward records with available label imagery; physical-form submissions are excluded. This is not guaranteed to cover every TTB record or field.
- A barcode decoded from an image is label evidence, not proof of a GS1 assignment or a canonical product identity. Values can be missing or wrong; the same product can have multiple approvals and the same barcode can appear on multiple approvals.
- A COLA approval is not proof of retail launch, current availability, or sales.
- Public sample pack: 1,000 records.
- Free plan: $0/month; 200 detail views/month, 10,000 list records/month, 10 requests/minute, label images and API access.
- Bulk warehouse delivery is a separate license through Snowflake share or S3 export. No bulk license has been requested or purchased.
- Registry/data page: https://colacloud.us/cola-registry
- Pricing: https://colacloud.us/pricing
- Documentation: https://docs.colacloud.us/introduction

### Other barcode sources worth benchmarking
- UPC Data 4 Beverage Alcohol advertises a fully attributed beer, wine, liquor, mixer and alcoholic-cocktail database with 150,000+ records, including UPC/EAN, brand line, item, container, size, wine vintage/varietal/region and liquor ABV. Commercial terms are quote-based: https://upcdata4spirits.com/
- GS1 US Product API provides product/GTIN data, but its API add-on is listed at $6,500. This is a verified-identity path worth considering only if the business case justifies it: https://www.gs1us.org/tools/gs1-us-data-hub/gs1-us-apis
- Open Food Facts has an open product API, but it is community-contributed and its own documentation warns data may be inaccurate, incomplete or unreliable. It can be a supplementary source, not the authoritative alcohol SKU catalog: https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/

## Current Discover DEV catalog state (queried 2026-11-11)
- `public.product_index`: 285 rows.
- All 285 rows currently have `category IS NULL`.
- The current starter set is brand-level only: `product IS NULL`, no SKU/vintage/size-specific catalog records.
- Starter source field is `harmony_menu_top_brands_2026_11`.
- `bottle_sightings`: 0 rows.
- `bottle_scan_usage`: 0 rows.
- Therefore the existing matcher is currently a fuzzy brand-name matcher, not a validated item/SKU resolver. A high fuzzy score must not be presented as verified product identity.

## Recommended Harmony data model

Keep external source records separate from canonical Harmony products:

1. `catalog_products`: canonical SKU/variant identity (brand, product/expression, category hierarchy, package size, ABV/proof, market, vintage/batch where applicable).
2. `product_identifiers`: GTIN/UPC/EAN as text, barcode symbology, package level (each/case/multipack), issuer/source, verification state, and effective dates. Never coerce GTINs to numbers or discard leading zeroes.
3. `label_evidence`: TTB COLA ID, image ID/type, image URL or licensed object reference, source approval status/date, OCR output, extracted attributes, barcode detections and bounding boxes.
4. `product_source_links`: source record to canonical product mapping, match method/score, provenance, reviewer, and decision status.
5. `product_aliases`: brand, fanciful name, product/expression, alternate spellings, languages and common abbreviations.

A COLA record must not be treated as a product row. Several COLAs can describe one product; one approval may show several label panels; a barcode may recur across approvals. Retain the many-to-many evidence links.

## Reader resolution order

1. Detect and decode barcode(s) on the frame (UPC-A, EAN-13, EAN-8, UPC-E, QR/GS1 Digital Link where supported).
2. Normalize symbology and GTIN check digit without converting the identifier to a number.
3. Exact lookup in verified identifiers.
4. If no exact verified match, query COLA barcode evidence and return candidate approval/product links with provenance.
5. In parallel, run label OCR and category-specific attribute extraction.
6. Resolve by brand + expression + size + ABV/proof + vintage/batch where relevant. Do not collapse distinct sizes, vintages, releases, package types, or keg/can/bottle SKUs.
7. If evidence conflicts or is incomplete, return candidates/unsure and request review; do not force a match.

## Benchmark before integration

Use the free 1,000-record sample or free-tier API to measure:
- Coverage by product class: spirits, wine, sparkling, beer, cider and non-alcoholic.
- Percentage with front label image, back label image, OCR text, UPC/EAN, and usable category.
- Barcode decode precision against the image and independent GS1 checks on a stratified subset.
- Duplicate approval-to-product ratios and barcode-to-product ambiguity.
- Vintage, package-size, ABV/proof, producer, appellation and varietal field coverage.
- API latency, quotas, image access rights, retention rules and bulk-license terms.
- Exact-match and top-k recall on a held-out Harmony bottle-photo test set, including multiple labels, curved glass, keg collars, cans, dark scenes and low-resolution images.

Do not ingest the full dataset or rely on a claimed barcode count until these tests pass. Do not treat a decoded UPC as a verified GTIN assignment.

## Decision

Proceed with a sample benchmark, not a bulk purchase. COLA Cloud looks promising for broad label-image coverage and barcode evidence; GS1 is the stronger verification layer but materially more expensive. UPC Data 4 Beverage Alcohol is a possible complementary item-level source. Open Food Facts is supplemental only.
