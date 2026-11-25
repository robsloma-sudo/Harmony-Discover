# Menu tap-to-explore (problem P-20261123-0711, part 4: app screens)

After a menu read, drink lines are linked to the cocktail and each spirit, wine or beer in it.
Linked lines show a green LINKED marker and tappable chips; unlinked drink lines say "Not linked yet".

- Tap a cocktail: `app/explore-cocktail.tsx` (simple cocktail maker: swap base, smokier, lower proof, less sweet, more citrus, undo).
- Tap a spirit, wine or beer: `app/journey.tsx` (real Journey; "Building this story..." while the server writes it).
- Modified cocktail: save as "my version" (`app/my-versions.tsx`, stored on the phone first, server sync best effort),
  `app/show-bartender.tsx` (full-screen recipe card, no venue), `app/make-at-home.tsx` (steps + bottles you need).
- Taps and changes are recorded anonymously (type, kind, ref, action, time only).
- Journeys for linked lines are pre-loaded as soon as links arrive and cached on the phone for 7 days.

## Server programs are placeholders
All server paths live in `src/services/menuExplore/endpoints.ts` as `PLACEHOLDER-*` names until part 3 (Discover backend)
gives the final names. With `EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK=1` (dev only) the app uses clearly labelled sample data,
and `/dev-menu-explore` shows a sample linked menu.

## Not done here
- Library panel link to "My versions" lives in `app/index.tsx`, which open scanner PRs change; deferred.
- No search for nearby venues serving a modified drink (by design).

Screenshots: `docs/screens/menu-tap-explore/`.
