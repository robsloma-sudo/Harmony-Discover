// Supabase Edge Function entry: discover-checkins (built into supabase/functions/discover-checkins/ by scripts/build-edge.mjs).
// Refuses to run outside the Discover DEV project (same guard as discover-api). Venue verification reads Harmony Atlas
// through PHG's public, read-only discover_atlas_points door (same SQL core as Harmony Atlas). No PHG writes.
import { createDiscoverClient } from '../api/src/core/client.ts';
import { makeIdentify } from '../api/src/core/identity.ts';
import { dbLimiter } from '../api/src/core/limiter.ts';
import { handleCheckins, type CheckinsEdgeDeps } from './checkins-router.ts';
import type { AtlasLayer, AtlasRow } from '../../src/services/phgAtlasRecords.ts';

declare const Deno: { env: { toObject(): Record<string, string> }; serve(h: (r: Request) => Response | Promise<Response>): unknown };

// Public client settings, identical to what the Discover web app already ships (publishable key, never service-role).
const PHG_URL_DEFAULT = 'https://lqjtwabzmgjcufftuqvu.supabase.co';
const PHG_KEY_DEFAULT = 'sb_publishable_nifWfkBSGDpOAbQfmmofzw_C6CKy62T';
const DEFAULT_ORIGINS = ['https://harmony-discover.netlify.app', 'https://harmony-discover-test.netlify.app', 'https://discover-scanner-dev--harmony-discover.netlify.app'];

let deps: CheckinsEdgeDeps | null = null; let refused = '';
try {
  const env = Deno.env.toObject();
  // Discover's own web sites, plus anything listed in DISCOVER_ALLOWED_ORIGINS (the same list discover-api uses).
  const configured = (env.DISCOVER_ALLOWED_ORIGINS ?? '').split(',').map(v => v.trim()).filter(v => {
    try { const u = new URL(v); return u.protocol === 'https:' && u.origin === v; } catch { return false; }
  });
  const allowedOrigins = new Set([...DEFAULT_ORIGINS, ...configured]);
  if (env.DISCOVER_CHECKINS_ENABLED === 'false') throw new Error('check-ins disabled by DISCOVER_CHECKINS_ENABLED=false');
  const db = createDiscoverClient({ DISCOVER_ENV: 'development', DISCOVER_ALLOWED_PROJECT_REFS: 'lqqmwqrffelgnbngrkep', ...env });
  const phgUrl = (env.PHG_ATLAS_URL || PHG_URL_DEFAULT).replace(/\/$/, '');
  const phgKey = env.PHG_ATLAS_PUBLISHABLE_KEY || PHG_KEY_DEFAULT;
  deps = {
    identify: makeIdentify(db),
    allowedOrigins,
    checkins: {
      db,
      limiter: dbLimiter(db, 'checkins', 30, 60),
      async fetchAtlas(layer: AtlasLayer, b) {
        const response = await fetch(phgUrl + '/rest/v1/rpc/discover_atlas_points', {
          method: 'POST', headers: { 'content-type': 'application/json', apikey: phgKey, authorization: 'Bearer ' + phgKey },
          body: JSON.stringify({ p_layer: layer, p_west: b.minLng, p_south: b.minLat, p_east: b.maxLng, p_north: b.maxLat, p_limit: 200 }),
        });
        const payload = await response.json().catch(() => null) as { layer?: string; rows?: AtlasRow[] } | null;
        if (!response.ok || !payload || payload.layer !== layer || !Array.isArray(payload.rows)) throw new Error('phg_atlas_' + response.status);
        return payload.rows;
      },
    },
    log: (m, e) => console.error(m, e instanceof Error ? e.message : e),
  };
} catch (e) { refused = e instanceof Error ? e.message : String(e); console.error(refused); }

Deno.serve(req => deps ? handleCheckins(req, deps)
  : new Response(JSON.stringify({ error: 'environment_refused' }), { status: 503, headers: { 'content-type': 'application/json' } }));
