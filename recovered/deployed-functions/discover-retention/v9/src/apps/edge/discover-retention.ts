// GENERATED from apps/edge/discover-retention.ts by scripts/build-edge.mjs. Do not edit; deploy to the Discover DEV project only.
// Supabase Edge Function entry: discover-retention. Called once a day by pg_cron (migration 0010). The caller must send the
// secret the database generated and keeps in Vault (migration 0009); it is checked by the database, never stored here.
// Runs Rob's two retention rules: menu photos (superseded, or 90 days) and raw learning events (13 months).
import type { SupabaseClient } from '@supabase/supabase-js';
import { createDiscoverClient } from '../api/src/core/client.ts';
import { BUCKET } from '../api/src/core/observations.ts';
import { retentionSweep, type DuePhoto } from '../api/src/retention.ts';

declare const Deno: { env: { toObject(): Record<string, string> }; serve(h: (r: Request) => Response | Promise<Response>): unknown };
// Non-secret guard settings default to the Discover DEV project; SUPABASE_URL always comes from Supabase, so this code
// refuses to run if it is ever deployed to any other project (including Harmony production).
const env: Record<string, string | undefined> = { DISCOVER_ENV: 'development', DISCOVER_ALLOWED_PROJECT_REFS: 'lqqmwqrffelgnbngrkep', ...Deno.env.toObject() };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async req => {
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
  let db: SupabaseClient;
  try { db = createDiscoverClient(env); } catch { return reply(503, { error: 'environment_refused' }); }
  const given = req.headers.get('x-discover-cron-secret') ?? '';
  const { data: allowed, error: checkError } = await db.rpc('discover_check_cron_secret', { p_given: given });
  if (checkError || allowed !== true) return reply(401, { error: 'unauthorized' });
  const capDays = Number(env.PHOTO_RETENTION_CAP_DAYS || 90);          // Rob, 9 Nov 2026
  const months = Number(env.LEARNING_EVENT_RETENTION_MONTHS || 13);   // Rob, 9 Nov 2026
  const photos = await retentionSweep({
    async listDue(cap, limit) {
      const { data, error } = await db.rpc('discover_photos_due_for_deletion', { p_cap_days: cap, p_limit: limit });
      if (error) throw new Error('retention_list_failed');
      return (data ?? []) as DuePhoto[];
    },
    async removeObjects(paths) { const { error } = await db.storage.from(BUCKET).remove(paths); if (error) throw new Error('storage_remove_failed'); },
    async markDeleted(id, reason) { const { error } = await db.rpc('discover_mark_photo_deleted', { p_asset: id, p_reason: reason }); if (error) throw new Error('mark_failed'); },
    log: (m, d) => console.warn(m, d),
  }, capDays).catch(e => ({ examined: 0, deleted: 0, failed: 1, error: String(e) }));
  let purged = 0, eventsFailed = false;
  for (let i = 0; i < 100; i++) {
    const { data, error } = await db.rpc('discover_purge_learning_events', { p_months: months });
    if (error) { eventsFailed = true; break; }
    purged += Number(data ?? 0); if (!data) break;
  }
  const failed = photos.failed > 0 || eventsFailed;
  const body = { photos: { capDays, ...photos }, events: { months, purged, failed: eventsFailed } };
  console.log(JSON.stringify({ job: 'discover-retention', ...body }));
  return reply(failed ? 500 : 200, body);
});
