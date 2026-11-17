// Venue check-ins and the public per-venue feed (Discover DEV only).
//
// The browser sends its current fix ONLY so the server can confirm the chosen venue is really nearby. The fix is used
// in memory for that one comparison and is never written to the database or to logs; the database keeps the venue,
// the rounded distance and the GPS accuracy (see migration 20261116170000).
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ok, type Result, type SubjectLimiter } from './http.ts';
import { boundsAround, checkinSearchRadiusM, haversineMeters, CHECKIN_POLICY } from '../../../../src/services/venueCheckin.ts';
import { ATLAS_REF, atlasRowToVenue, isAtlasLayer, type AtlasLayer, type AtlasRow } from '../../../../src/services/phgAtlasRecords.ts';

type Log = (m: string, e: unknown) => void;
type Bounds = { minLat: number; minLng: number; maxLat: number; maxLng: number };

export interface CheckinDeps {
  db: SupabaseClient;
  limiter: SubjectLimiter;
  /** Read Harmony Atlas rows for one layer inside a small box (PHG discover_atlas_points). Read-only. */
  fetchAtlas(layer: AtlasLayer, bounds: Bounds): Promise<AtlasRow[]>;
}

/** "<Harmony Atlas layer>:<Atlas key>", e.g. "stores:off:IA:store-5109" or "venues:oak park restaurant|des moines|IA". */
export const VENUE_REF = ATLAS_REF;

const checkinSchema = z.object({
  venueRef: z.string().regex(VENUE_REF),
  device: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyM: z.number().min(0).max(5000),
  }).strict(),
  trigger: z.enum(['bottle_scan', 'menu_scan', 'live_scan', 'manual']),
  selection: z.enum(['suggested', 'chosen_from_list', 'searched']),
  shareScans: z.boolean(),
}).strict();

export async function recordCheckin(deps: CheckinDeps, subjectId: string, body: unknown, log?: Log): Promise<Result> {
  const parsed = checkinSchema.safeParse(body);
  if (!parsed.success) return ok({ error: 'invalid_checkin' }, 400);
  const { venueRef, device, trigger, selection, shareScans } = parsed.data;
  if (device.accuracyM > CHECKIN_POLICY.maxUsableAccuracyM) return ok({ error: 'location_too_inaccurate' }, 422);

  const layer = venueRef.slice(0, venueRef.indexOf(':'));
  if (!isAtlasLayer(layer)) return ok({ error: 'invalid_checkin' }, 400);
  const radiusM = checkinSearchRadiusM(device.accuracyM);
  let records: AtlasRow[];
  try { records = await deps.fetchAtlas(layer, boundsAround(device, radiusM)); }
  catch (error) { log?.('checkin atlas lookup failed', error instanceof Error ? error.message : 'unknown'); return ok({ error: 'atlas_unavailable' }, 503); }

  const venue = records.map(r => atlasRowToVenue(layer, r, device)).find(v => v?.id === venueRef) ?? null;
  if (!venue) return ok({ error: 'venue_not_nearby' }, 422);
  const distanceM = Math.round(haversineMeters(device, venue));
  if (distanceM > radiusM) return ok({ error: 'venue_not_nearby' }, 422);

  const { data, error } = await deps.db.rpc('discover_checkin_record', {
    p_subject: subjectId, p_source_ref: venue.id, p_name: venue.name, p_venue_type: venue.venue_type,
    p_latitude: venue.latitude, p_longitude: venue.longitude, p_address_line: venue.address_line,
    p_locality: venue.locality, p_region: venue.region, p_postal_code: venue.postal_code,
    p_trigger: trigger, p_selection: selection, p_distance_m: distanceM,
    p_accuracy_m: Math.round(Math.min(device.accuracyM, CHECKIN_POLICY.maxUsableAccuracyM)),
    p_share_scans: shareScans, p_attach_recent_minutes: 10,
  });
  if (error) {
    if (String(error.message || '').includes('checkin_rate_limited')) return ok({ error: 'rate_limited' }, 429);
    log?.('checkin record failed', error.message || 'unknown');
    return ok({ error: 'checkin_failed' }, 500);
  }
  const row = data as { checkin_id: string; venue_id: string; expires_at: string; attached_bottles: number; attached_menus: number };
  return ok({
    checkinId: row.checkin_id, venueRef: venue.id, venueName: venue.name, venueType: venue.venue_type,
    distanceM, expiresAt: row.expires_at, shareScans, attached: { bottles: row.attached_bottles, menus: row.attached_menus },
  }, 201);
}

export async function withdrawCheckin(db: SupabaseClient, subjectId: string, checkinId: string, log?: Log): Promise<Result> {
  if (!z.string().uuid().safeParse(checkinId).success) return ok({ error: 'checkin_not_found' }, 404);
  const { data, error } = await db.rpc('discover_checkin_withdraw', { p_subject: subjectId, p_checkin: checkinId });
  if (error) { log?.('checkin withdraw failed', error.message || 'unknown'); return ok({ error: 'checkin_withdraw_failed' }, 500); }
  return data === true ? ok({ withdrawn: true }) : ok({ error: 'checkin_not_found' }, 404);
}

export async function venueFeed(db: SupabaseClient, ref: string | null, days: string | null, log?: Log): Promise<Result> {
  if (!ref || !VENUE_REF.test(ref)) return ok({ error: 'invalid_venue_ref' }, 400);
  const window = days == null ? 90 : Number(days);
  if (!Number.isInteger(window) || window < 1 || window > 365) return ok({ error: 'invalid_days' }, 400);
  const { data, error } = await db.rpc('discover_venue_public_feed', { p_source_ref: ref, p_days: window });
  if (error) { log?.('venue feed failed', error.message || 'unknown'); return ok({ error: 'venue_feed_unavailable' }, 503); }
  return ok(data);
}
