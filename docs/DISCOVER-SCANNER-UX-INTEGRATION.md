# Discover Scanner UX and Harmony Integration Contract

**Status:** feature branch implementation plan and current client contract  
**Scope:** Harmony Discover only. This document does not authorize changes to Harmony Core or Harmony Journeys production.

## Product behavior

Discover has two clear capture paths:

1. **Smart Scan** — one or more photos (up to six in the current live scanner) are sent to the Discover DEV `discover-live-read` function. It may return bottle reads and a lightweight menu glimpse from the same frame. The user reviews the result. Bottle sightings are saved privately to Discover. If a menu is detected, the user can hand the selected photo set to the full multi-page menu workflow.
2. **Menu Pages** — a dedicated menu workflow supports up to twelve pages, explicit processing notice, structured extraction, item corrections, venue confirmation and a separate optional contribution grant.

The Smart Scan and Menu Pages paths are intentionally different UX entry points over existing DEV services. Do not route either path to a new generic worker unless the deployed function contract has been recovered and parity verified.

## Scanner interaction contract

- Camera/gallery selection is user-initiated.
- Smart Scan supports bottle and menu detection in the same photo batch.
- Menu Pages supports up to twelve pages and preserves all selected pages through preview.
- A failed photo can be retried without restarting the whole batch.
- Bounding boxes are normalized against the source image and must be mapped to the actual contained-image rectangle, not the outer camera card.
- Multiple detected bottles must be individually selectable.
- User-reviewed bottle sightings are private to Discover. Saving a sighting is not permission to contribute it to Harmony.
- Menu contribution is a separate, explicit opt-in after venue confirmation. It enters a private review path; it does not publish or update canonical Harmony records automatically.
- Extraction confidence and canonical product-match confidence must remain distinct. The UI must not claim exact product identity solely because a label was readable.

## Harmony Core boundary

Harmony Core / PHG owns canonical venues, menus, products, brands, recipes and beverage intelligence. Discover owns consumer observations and evidence in its isolated DEV project.

The Discover client must not write directly to Core production tables or use Core service-role credentials. Future promotion must be a server-side, auditable, idempotent and explicitly approved reconciliation process. It must retain provenance, consent, reviewer decisions and source evidence.

## Harmony Journeys boundary

Harmony Journeys is a separate front-end experience on the Core production project. It consumes approved/canonical knowledge; it is not the destination for raw consumer photos or unreviewed OCR.

The current Discover-side handoff:
- carries scan context into a local Discover Journey screen;
- clearly labels the context as a Discover observation;
- displays the captured entity context in a local Discover handoff screen;
- does not attempt to open the Journeys player until a supported cross-app initialization contract exists;
- does not claim that the Journeys site has received the scanned entity.

**Why the launch is pending:** the current `journeys.html` player initializes from a host `postMessage` carrying `phgJ: 'init'` and `journey.journey_id`. It rejects messages unless the sender origin equals the Journeys page origin and the sender is its parent. A direct Discover-to-Journeys cross-origin launch therefore cannot initialize the player. Do not fake this with guessed query parameters.

**Required future contract:** Journeys must expose a supported, secure handoff accepting a stable canonical journey/entity identifier (not raw OCR text or private image URLs), plus Discover source attribution. The receiving side should validate the identifier and access rights, then initialize the existing player through its own trusted host. This requires a separate Journeys implementation and explicit approval; this branch does not modify it.

## UI delivery sequence

1. Make Smart Scan vs Menu Pages explicit at the camera entry point.
2. Fix scanner feedback: correct image-coordinate overlays, per-photo retry, selectable bottle results and clear private-save language.
3. Carry bottle/menu context into a Discover Journey handoff without inventing facts.
4. Keep menu corrections and explicit contribution consent intact.
5. Validate on web and real iOS devices; verify camera permission, HEIC conversion, multi-photo selection, retries, orientation, and back/close behavior.

## Out of scope for this branch

- Product catalog population, SKU research or matching algorithm changes (owned by the separate catalog agent).
- Changes to Harmony Core / PHG repository, database, deployment or canonical data.
- Changes to Harmony Journeys repository, production database, deployment or UI.
- Any production Supabase writes, migrations, Edge Function deployment or Netlify production deployment.
