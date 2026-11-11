# Harmony cocktail intelligence integration

## Decision
Use Harmony's existing cocktail intelligence as a first-class capability inside Harmony Discover. Do not copy production tables into the consumer database and do not connect the mobile app directly to production Supabase. Expose a narrow, read-only server-side adapter over approved production data, then persist consumer-created remixes and personal notes in the isolated Discover backend.

## Verified production inventory (read-only inspection)
The production project contains:
- `cocktail_reference`: 150 consensus/reference cocktail identities, aliases, base-spirit normalization, profile, consensus spec, source basis, method, glassware, garnish.
- `cocktail_specs`: 449 structured cocktail identities/variants with parent/variant relationships, match policy, recognition, default base spirit.
- `cocktail_spec_components`: 468 component rows with role, spirit family, category, ingredient text, replacement flag, notes.
- `cocktail_spec_sources`: 449 source-link rows.
- `cocktail_spec_terms`: 649 resolver terms.
- `cocktail_tag_dimensions`: 13 dimensions.
- `cocktail_tag_values`: 108 controlled tag values.
- `cocktail_tag_terms`: 199 matching terms.
- `menu_item_cocktail_core`: 3,720 resolver records linking menu extraction to cocktail spec, match status, identity class, base spirit and price comparability.
- `v_cocktail_items_filterable`: 3,517 rows with menu item, venue, matched spec, base spirits, modifiers, lengtheners, flavour cues, acids and serve/deviation cues.
- `v_cocktail_build_combinations`: aggregate build-family/base/modifier/lengthener patterns and menu/price coverage.
- `v_venue_cocktail_profile`: venue-level cocktail mix, original share, family mix, spirit mix, and median price.
- `cocktails`: 95 saved generated cocktail records with original drink, current drink and version history. This is user-owned content; do not expose other users' records.
- `cocktail_prep_library`: 183 personal prep records with ingredients, steps, yield, shelf life, notes and linked cocktail ids. User-owned; do not expose other users' records.
- `recipe_books`: personal recipe collections.
- `cocktail_costs`: model/step token and cost ledger.

Counts are the inspected database's current reported rows at inspection time; not all rows are public consumer content. The menu view is a commercial/analytical source and must be filtered, rights-reviewed, and served only through a purpose-built API.

## Important gap
The inspected schema exposes flavour-cue taxonomy and acid cue fields, but no dedicated molecular aroma-compound library was identified by table/column-name inspection. `cola_records.llm_tasting_note_flavors` is explicitly third-party AI enrichment, not verified sensory chemistry. Do not present it as molecular compound evidence.

## Consumer experience
### A. Understand this cocktail
For a menu item with a confident spec match:
- What style/family is this?
- Typical structure and likely base spirit.
- Flavor direction: citrus, berry, tropical, herbal/floral, spice, coffee, chocolate/dessert, etc.
- Sweet/sour/bitter/bold/refreshing balance, only when supported by the spec or transparent inference.
- Glassware, method and garnish where available.
- Clearly distinguish the canonical recipe from this venue's actual recipe.

### B. Save and make it yours
Save a snapshot of:
- Original menu wording and venue/date observation.
- Matched canonical cocktail identity and match confidence.
- Any menu-listed ingredients, explicitly marked as menu-observed.
- Harmony reference spec and component provenance.
- User's own remix lineage.

Offer creative controls:
- Keep the spirit, change the flavor direction.
- Make it brighter / drier / less sweet / more bitter / more aromatic / lower ABV.
- Swap base spirit or modifier.
- Explore a seasonal ingredient.
- Preserve the original and create a new version.
- Add tasting notes and a personal rating.

Every remix is a new version, never an overwrite of the original menu drink or canonical reference recipe.

### C. Talk it through
A conversational cocktail studio should understand:
- Original drink and venue context.
- User's taste profile (only if opted in).
- Recipe components and roles.
- Flavor/aroma taxonomy.
- Acid/sugar/dilution/ABV variables where measurements are available.
- Constraints such as ingredients on hand, equipment, batch size, and service style.

The assistant should ask one useful question at a time and explain the consequence of each change. For example: "If we increase citrus without changing syrup, the drink will taste sharper and less sweet; do you want to preserve the current balance?"

## Evidence model
Use field-level provenance:
- `menu_observed`: explicitly printed on the menu or confirmed by user.
- `canonical_reference`: from a Harmony canonical cocktail spec.
- `venue_confirmed`: venue-confirmed recipe or detail.
- `sensory_interpretation`: qualitative expectation from known ingredients/structure.
- `molecular_evidence`: only when a named compound and source support it.
- `user_created`: consumer's own modification.
- `unknown`: not established.

Never claim a venue's actual recipe is the canonical spec. Never infer exact brand, recipe ratio, compound concentration, pH, Brix or ABV from a cocktail name alone.

## Architecture
Discover app -> Discover API -> Cocktail Intelligence Adapter -> read-only approved Harmony services/data.
Consumer remix writes -> isolated Discover database only.

The adapter should return a consumer-safe DTO, not raw production table rows. It should:
1. Resolve menu item to `cocktail_specs` with match policy/confidence.
2. Fetch components and source links.
3. Fetch permitted tag values and terms.
4. Return flavor cues and acids as taxonomy labels, not chemical claims.
5. Include evidence state and source identifiers.
6. Exclude personal `cocktails`, `cocktail_prep_library`, and `recipe_books` data from shared queries.
7. Cache stable canonical spec responses.
8. Log adapter version and source timestamps.

## Proposed consumer API
- `GET /v1/cocktails/resolve?name=...`
- `GET /v1/cocktails/specs/{specId}`
- `POST /v1/collections/cocktails` (save a menu drink snapshot)
- `POST /v1/cocktails/{savedId}/remixes` (create a new version)
- `POST /v1/cocktails/{savedId}/conversation` (create/update remix session)
- `GET /v1/cocktails/{savedId}/versions`

These are proposed contracts, not deployed endpoints.

## Data ownership and licensing
- Personal saved cocktails, taste profile, conversations, and remixes belong to the consumer and remain private.
- Harmony canonical reference data may be displayed according to product licensing and source attribution.
- Venue menu evidence remains separately attributed to observation source and capture date.
- Commercial menu analytics must not expose consumer identity, individual drinking history, or private conversations.
- Do not copy full proprietary production tables into the consumer database without rights and authorization review.

## Build order
1. Ship flavor cues and canonical spec explanations in the Journey using the read-only adapter.
2. Add save-to-collection snapshot.
3. Add personal remix versions and conversational editor.
4. Add quantitative formulation tools (acid/sugar/dilution/ABV) only where recipe quantities and measurement assumptions exist.
5. Add molecular compound education only after a sourced compound dataset is located, reviewed and linked to specific ingredients/chemistry.
