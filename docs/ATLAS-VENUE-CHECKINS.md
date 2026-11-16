# Discover Atlas: mirrored on Harmony Atlas, plus venue check-ins and the venue feed

Scope (Rob, 2026-11-16): build out the Atlas features Discover already has and make them match, mirror and
pipeline to PHG/Harmony Atlas. Do not bring the full Harmony Atlas engine or its staff tools into Discover.

## What matches Harmony Atlas now

| | Harmony Atlas (atlas.html) | Discover Atlas |
|---|---|---|
| Map engine | MapLibre GL 5.24.0, unpkg | same version and URL, SRI-pinned |
| Basemap | Satellite (Esri imagery + OpenFreeMap positron labels), globe + sky | same code, copied verbatim (`atlasBasemaps.web.ts`) |
| Data | `phg_atlas_points` / `phg_atlas_clusters` | `discover_atlas_points` / `discover_atlas_clusters` -> **same SQL core** |
| Layers + colours | venues #22d3ee, licences #c4b5fd, stores #f59e0b, distill #f5b54a, wineries #fb7185, breweries #eab308 | same |
| Zoomed out / in | bubbles below zoom 9, points from 9 (`ATZ`, `gridBox`) | same rule and grid |
| 3D | pitch 58, bearing -18 | same |
| Select venue | fly to zoom >= 15 | same |
| Venue menu | `phg-menu-pages` captured pages (staff login) | `phg-discover-menu-pages`, same pages and matching rule, public |

Discover keeps only its own controls: radius, category filters, search, venue list, zoom, recenter, 3D, full screen.

## PHG side (applied 2026-11-16, Rob approved "use everything")

- `phg_atlas_points_core` / `phg_atlas_clusters_core`: generated from the existing functions (text copy minus the
  two auth lines). `phg_atlas_points` / `phg_atlas_clusters` now = same auth gate + core. Verified identical output on
  22 sample queries (md5 before == after). Old definitions saved in `phg.fn_backups` (`*@pre_discover_mirror`).
- `discover_atlas_points` / `discover_atlas_clusters`: public, read-only, six layers only (no census), venue rows drop
  rating and demographics, bounds <= 3 degrees, <= 1000 rows.
- Edge Function `phg-discover-menu-pages`: read-only, 30-minute signed links, Discover origins only, no AI calls.

## Discover DEV side (applied 2026-11-16)

- Migration `20261116170000_discover_venue_checkins_and_public_feed.sql` (function bodies verified identical to the file).
- Edge Function `discover-checkins`: `POST /v1/checkins`, `DELETE /v1/checkins/:id`, `GET /v1/venues/feed?ref=`.
  Verified live: check-in at an Iowa liquor store 11 m away (201), 5 km away rejected, no login 401, wrong origin 403,
  feed returns the venue, undo works. Test rows removed.

## Check-in rules (`src/services/venueCheckin.ts`)

Never silent. Fix older than 2 min or accuracy > 400 m: no prompt. 120-400 m: list, nothing pre-selected.
Clear nearest (runner-up >= 1.6x and >= 35 m farther): "Are you at X?". Tie: "Which place are you at?".
No re-prompt within 90 min while within ~200 m; "Not here" quiets that spot for 30 min.
Server re-checks the venue against Harmony Atlas and computes the distance itself; the device position is never stored.

## Still open

- Web app code is in this branch only: GitHub refused writes from this session, so it is not merged or deployed.
- `discover-api` in DEV answers `environment_refused` (missing `DISCOVER_ALLOWED_ORIGINS` secret) - pre-existing;
  `discover-checkins` falls back to the Discover site origins.
- Photos of scanned bottles on venue pages, native iPhone map pitch and location prompt: not built.
