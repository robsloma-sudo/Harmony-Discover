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

- Migration `20261116165919_discover_venue_checkins_and_public_feed.sql` (live version number) (function bodies verified identical to the file).
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

## Pins and Street View (added 2026-11-16)

- Zoomed in (zoom 9+), every place is a teardrop pin whose tip sits on the business's exact point. Pins grow as you
  zoom in and shrink as you zoom out. Below zoom 9 the Harmony Atlas count bubbles stay.
- One simple emoji per kind, inside a pin in the Harmony Atlas layer colour: on premise 🍸 bar / 🍽️ restaurant,
  off premise 🏪 liquor store, 🍺 brewery, 🍷 winery, 🥃 distillery. The selected place gets a bigger pin.
- Street View plays live inside the page (Google Maps Embed, same key and URL format as Harmony Atlas): in every venue
  card, and anywhere you tap on the full-screen map away from a pin. No redirect. The iPhone app opens Google Maps
  until it gets an embedded browser view.
- The key comes from PHG through `phg-discover-menu-pages` (`op: streetview`). Google must allow the Discover web
  address on that key (Google Cloud Console > Credentials > the Maps key > Website restrictions).

## Smooth zoom (2026-11-16)

- Black-out cause: Harmony Atlas's `vertical-perspective` projection stays a globe at every zoom and stops drawing from
  about zoom 16.3 (pins and imagery both vanished). Discover uses `globe`: a globe when zoomed out, flat up close.
- Black boxes while zooming: tiles were cancelled mid-pinch and faded in. Now: no cancelling while zooming, no fade, a
  bigger tile cache, 256 px imagery tiles (a quarter of the requests) and a low-detail imagery underlay so a loading
  tile shows a soft picture instead of black. Drawing resolution capped at 2x.
- Max zoom 19 (the deepest level with real satellite imagery; level 20 is a grey placeholder).
- Map credits stay (required by OpenStreetMap/Esri) but are folded into the small (i) button.
- Test: 24 fast zoom in/out frames between levels 12 and 19, 0 % black in every frame; pins and imagery at 17, 18, 19.
