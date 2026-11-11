// Supabase Edge Function entry: discover-api (built into supabase/functions/discover-api/ by scripts/build-edge.mjs).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. The non-secret guard settings default to the Discover
// DEV project; because SUPABASE_URL always comes from Supabase, this code refuses to run if deployed to any other project
// (including Harmony production). If the guard refuses, every request gets 503.
import { createDiscoverClient } from '../api/src/core/client.ts';
import { makeIdentify } from '../api/src/core/identity.ts';
import { dbLimiter } from '../api/src/core/limiter.ts';
import { supabaseLearningStore } from '../api/src/lib/learningStore.ts';
import { supabaseAccountStore } from '../api/src/lib/accountStore.ts';
import { BUCKET } from '../api/src/core/observations.ts';
import { handle, type EdgeDeps } from './router.ts';

declare const Deno: { env: { toObject(): Record<string, string> }; serve(h: (r: Request) => Response | Promise<Response>): unknown };

let deps: EdgeDeps | null = null; let refused = '';
try {
  const runtimeEnv = Deno.env.toObject();
  const allowedOrigins = new Set((runtimeEnv.DISCOVER_ALLOWED_ORIGINS ?? '').split(',').map(v => v.trim()).filter(v => {
    try { const parsed = new URL(v); return parsed.protocol === 'https:' && parsed.origin === v; } catch { return false; }
  }));
  if (!allowedOrigins.size) throw new Error('DISCOVER_ALLOWED_ORIGINS must contain at least one exact HTTPS origin');
  const db = createDiscoverClient({ DISCOVER_ENV: 'development', DISCOVER_ALLOWED_PROJECT_REFS: 'lqqmwqrffelgnbngrkep', ...runtimeEnv });
  deps = {
    identify: makeIdentify(db),
    learning: { store: supabaseLearningStore(db), limiter: dbLimiter(db, 'learning', 120, 60) },
    account: {
      store: supabaseAccountStore(db), limiter: dbLimiter(db, 'account', 10, 60),
      async removeObjects(paths) { const { error } = await db.storage.from(BUCKET).remove(paths); if (error) throw new Error('storage_remove_failed'); },
      async deleteAuthUser(id) { const { error } = await db.auth.admin.deleteUser(id); if (error && error.status !== 404) throw new Error('auth_user_delete_failed'); },
    },
    observations: { db, limiter: dbLimiter(db, 'observations', 60, 60) },
    allowedOrigins,
    async readMenu(observationId, authorization) {
      const response = await fetch(runtimeEnv.SUPABASE_URL + '/functions/v1/discover-menu-read', {
        method: 'POST', headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ observation_id: observationId }),
      });
      const body = await response.json().catch(() => ({ error: 'menu_reader_invalid_response' }));
      return { status: response.status, body };
    },
    log: (m, e) => console.error(m, e instanceof Error ? e.message : e),
  };
} catch (e) { refused = e instanceof Error ? e.message : String(e); console.error(refused); }

Deno.serve(req => deps ? handle(req, deps)
  : new Response(JSON.stringify({ error: 'environment_refused' }), { status: 503, headers: { 'content-type': 'application/json' } }));
