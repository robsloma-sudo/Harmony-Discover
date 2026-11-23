// ALL server paths for Menu tap-to-explore live here. Part 3 (Discover backend)
// has not named the real programs yet: swap the PLACEHOLDER-* names below, nothing else.
const BASE = '/v1/explore';
export const EXPLORE_ENDPOINTS = {
  menuLinks: `${BASE}/PLACEHOLDER-menu-links`,           // GET ?observation=<id>
  journey: `${BASE}/PLACEHOLDER-journey`,                 // GET ?kind=&ref=
  journeyBuild: `${BASE}/PLACEHOLDER-journey-build`,      // POST {kind, refId, name}
  cocktail: `${BASE}/PLACEHOLDER-cocktail`,               // GET ?ref=
  cocktailModify: `${BASE}/PLACEHOLDER-cocktail-modify`,  // POST {recipe, action, option?}
  myVersions: `${BASE}/PLACEHOLDER-my-versions`,          // GET / POST {version} / DELETE ?id=
  event: `${BASE}/PLACEHOLDER-event`,                     // POST {type,itemKind,refId?,action?,at}
} as const;
