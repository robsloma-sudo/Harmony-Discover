# Harmony Discover Atlas data bridge

## Purpose

Expose a deliberately small, read-only subset of Harmony PHG's existing Atlas data to Harmony Discover. Discover's DEV Supabase remains the owner of Discover scans, uploads, user sessions, and contributions. The original PHG project remains the source of truth for Atlas, venue, licence, menu-coverage, brewery, winery, distillery, and product intelligence.

## Current findings (2026-11-12)

- Discover DEV project: `lqqmwqrffelgnbngrkep`.
- Harmony PHG project: `lqjtwabzmgjcufftuqvu`.
- Discover DEV currently has no rows in `discover_venues`.
- PHG contains existing Atlas RPCs including `phg_atlas_points`, `phg_atlas_clusters`, `phg_venues_near`, `phg_license_venues`, and `phg_menu_venue_find`.
- PHG's Atlas point/cluster RPCs require an authenticated user and `phg_atlas_allowed()`; that checks the caller's PHG auth context for developer or Atlas surface access.
- The current Discover anonymous session cannot call those PHG functions. Do not grant anonymous execution or weaken PHG Atlas authorization to make this work.

## Required bridge design

Deploy a new, separately named read-only bridge in the PHG project only after a dedicated PHG service identity is provisioned and granted the minimum Atlas surface permission. Do not reuse a user's personal session, do not use a browser-exposed service-role key, and do not put PHG secrets in Discover's client bundle.

The bridge must:
1. Authenticate Discover-to-bridge server-to-server using a dedicated secret stored only in server-side function secrets. Rotate it independently of other credentials.
2. Validate a narrow allow-list of actions and input schemas. Initial actions: `atlas_summary`, `atlas_clusters`, `atlas_points`, `venues_near`, `license_venues`, `menu_venue_find`.
3. Enforce bounded geographic extents, clamped result limits, per-action rate limits, and strict response field allow-lists.
4. Use the dedicated PHG identity's authenticated JWT to call existing PHG RPCs so the existing `phg_atlas_allowed()` gate remains effective. Never use service-role bypass as the user-facing authorization model.
5. Return only the data required for map pins, clusters, venue cards, menu coverage, and category counts. No account membership, user, sales, financial, or other tenant data.
6. Be read-only. No PHG writes, migrations, table mutations, or writes to the main Harmony project from Discover.
7. Log aggregate request counts and errors without storing precise user GPS coordinates or raw search queries longer than operationally necessary.

## Discover integration

- The browser talks only to the Discover DEV `discover-api` (or a dedicated Discover Atlas endpoint).
- Discover DEV server-side code calls the PHG bridge; the browser never sees the bridge credential or PHG JWT.
- Preserve anonymous Discover access by deriving a short-lived, coarse geographic search window from the user's opt-in location. Do not persist live coordinates in the venue directory.
- Discover scans and contributions continue to write only to Discover DEV.

## Basemap

The Atlas map's Carto raster tile URL was replaced in this branch with standard OpenStreetMap raster tiles, removing the Carto API-key watermark. Keep visible attribution to OpenStreetMap contributors. Respect the tile provider's usage policy; for production-scale usage, select an appropriate hosted tile provider or self-hosted tile infrastructure rather than treating the public OSM tile endpoint as unlimited capacity.

## Release gates

- No changes to PHG production schema, data, grants, policies, or functions as part of the first UI release.
- Do not deploy the PHG bridge until the dedicated identity and minimum permissions are reviewed and explicitly approved.
- Test no-key basemap rendering, iOS/web layout, pan/zoom, CORS, unauthorized bridge calls, bounds validation, rate limits, and response field minimization.
- Confirm Discover DEV and PHG project refs at runtime; fail closed if the PHG project ref is not exactly `lqjtwabzmgjcufftuqvu`.
