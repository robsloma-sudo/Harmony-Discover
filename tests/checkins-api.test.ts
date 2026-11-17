import { describe, expect, it, vi } from 'vitest';
import { handleCheckins, type CheckinsEdgeDeps } from '../apps/edge/checkins-router.ts';
import type { CheckinDeps } from '../apps/api/src/core/checkins.ts';

const HERE = { latitude: 41.5868, longitude: -93.6110 };
const north = (m: number) => HERE.latitude + m / 111_320;
// Rows shaped exactly like phg_atlas_points / discover_atlas_points output.
const venueRow = { k: "hall's bar|des moines|IA", n: "HALL'S BAR", c: 'DES MOINES', st: 'IA', vt: 'bar', f: 'bar', di: 120, ci: 14, pa: 13.5, lat: north(20), lng: HERE.longitude };
const storeRow = { k: 'off:IA:store-9', n: 'CORNER LIQUOR', c: 'Des Moines', st: 'IA', lt: 'Iowa ABD liquor store (class E)', lat: north(40), lng: HERE.longitude };
const VENUE_REF = "venues:hall's bar|des moines|IA";

function setup(over: Partial<CheckinDeps> = {}, rpcResult: { data?: unknown; error?: { message: string } | null } = {}) {
  const rpc = vi.fn(async () => ({ data: rpcResult.data ?? { checkin_id: '00000000-0000-4000-8000-000000000001', venue_id: 'v', expires_at: '2026-11-16T20:00:00Z', attached_bottles: 1, attached_menus: 0 }, error: rpcResult.error ?? null }));
  const fetchAtlas = vi.fn(async (layer: string) => layer === 'venues' ? [venueRow] : layer === 'stores' ? [storeRow] : []);
  const checkins: CheckinDeps = { db: { rpc } as never, limiter: { allow: () => true }, fetchAtlas, ...over };
  const deps: CheckinsEdgeDeps = { identify: vi.fn(async () => 'subject-1'), checkins, allowedOrigins: new Set(['https://harmony-discover.netlify.app']) };
  return { deps, rpc, fetchAtlas };
}

const post = (body: unknown, origin?: string) => new Request('https://d.example/functions/v1/discover-checkins/v1/checkins', {
  method: 'POST', headers: { authorization: 'Bearer s', 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
});
const good = { venueRef: VENUE_REF, device: { ...HERE, accuracyM: 12 }, trigger: 'bottle_scan', selection: 'suggested', shareScans: true };

describe('discover-checkins (Harmony Atlas venues)', () => {
  it('blocks unknown browser origins', async () => {
    const { deps } = setup();
    expect((await handleCheckins(post(good, 'https://evil.example'), deps)).status).toBe(403);
    expect((await handleCheckins(post(good, 'https://harmony-discover.netlify.app'), deps)).status).toBe(201);
  });

  it('verifies the Atlas venue server-side and stores distance and accuracy, not coordinates', async () => {
    const { deps, rpc, fetchAtlas } = setup();
    const r = await handleCheckins(post(good), deps);
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ venueRef: VENUE_REF, venueName: "Hall's Bar", venueType: 'bar', distanceM: 20, shareScans: true });
    expect(fetchAtlas).toHaveBeenCalledWith('venues', expect.objectContaining({ minLat: expect.any(Number) }));
    const args = (rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(args).toMatchObject({ p_subject: 'subject-1', p_source_ref: VENUE_REF, p_distance_m: 20, p_accuracy_m: 12, p_share_scans: true });
    expect(JSON.stringify(args)).not.toContain(String(HERE.latitude));
  });

  it('checks in at Atlas liquor stores', async () => {
    const { deps } = setup();
    const r = await handleCheckins(post({ ...good, venueRef: 'stores:off:IA:store-9' }), deps);
    expect(r.status).toBe(201);
    expect((await r.json()).venueType).toBe('liquor_store');
  });

  it('rejects a venue that is not near the device', async () => {
    const { deps, rpc } = setup({ fetchAtlas: vi.fn(async () => [{ ...venueRow, lat: north(5000) }]) });
    const r = await handleCheckins(post(good), deps);
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: 'venue_not_nearby' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects poor GPS, non-Atlas refs and extra fields before any lookup', async () => {
    const { deps, fetchAtlas } = setup();
    expect((await handleCheckins(post({ ...good, device: { ...HERE, accuracyM: 900 } }), deps)).status).toBe(422);
    expect((await handleCheckins(post({ ...good, venueRef: 'census:12345' }), deps)).status).toBe(400);
    expect((await handleCheckins(post({ ...good, venueRef: 'venues:bad\u0000ref' }), deps)).status).toBe(400);
    expect((await handleCheckins(post({ ...good, latitude: 1 }), deps)).status).toBe(400);
    expect(fetchAtlas).not.toHaveBeenCalled();
  });

  it('maps the database rate limit to 429 and Atlas outages to 503', async () => {
    expect((await handleCheckins(post(good), setup({}, { error: { message: 'checkin_rate_limited' } }).deps)).status).toBe(429);
    expect((await handleCheckins(post(good), setup({ fetchAtlas: vi.fn(async () => { throw new Error('boom'); }) }).deps)).status).toBe(503);
  });

  it('applies the per-subject limiter before any lookup', async () => {
    const { deps, fetchAtlas } = setup({ limiter: { allow: () => false } });
    expect((await handleCheckins(post(good), deps)).status).toBe(429);
    expect(fetchAtlas).not.toHaveBeenCalled();
  });

  it('withdraws only valid ids', async () => {
    const { deps } = setup({}, { data: true });
    const del = (id: string) => new Request('https://d.example/functions/v1/discover-checkins/v1/checkins/' + id, { method: 'DELETE', headers: { authorization: 'Bearer s' } });
    expect((await handleCheckins(del('not-a-uuid'), deps)).status).toBe(404);
    expect((await handleCheckins(del('00000000-0000-4000-8000-000000000001'), deps)).status).toBe(200);
  });

  it('serves the public venue feed for Atlas refs only', async () => {
    const { deps, rpc } = setup({}, { data: { venue: null, bottles: [], menus: [] } });
    const get = (q: string) => new Request('https://d.example/functions/v1/discover-checkins/v1/venues/feed' + q, { headers: { authorization: 'Bearer s' } });
    expect((await handleCheckins(get('?ref=' + encodeURIComponent(VENUE_REF)), deps)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('discover_venue_public_feed', { p_source_ref: VENUE_REF, p_days: 90 });
    expect((await handleCheckins(get('?ref=drop%20table'), deps)).status).toBe(400);
    expect((await handleCheckins(get('?ref=stores:x&days=9999'), deps)).status).toBe(400);
  });
});
