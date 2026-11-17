import { describe, expect, it } from 'vitest';
import { ATLAS_LAYERS, ATLAS_REF, atlasRowToVenue } from '../src/services/phgAtlasRecords';

const origin = { latitude: 41.5868, longitude: -93.611 };

describe('Harmony Atlas mirror records', () => {
  it('uses Harmony Atlas layer colours exactly', () => {
    expect(ATLAS_LAYERS).toMatchObject({ venues: { color: '#22d3ee' }, licences: { color: '#c4b5fd' }, stores: { color: '#f59e0b' },
      distill: { color: '#f5b54a' }, wineries: { color: '#fb7185' }, breweries: { color: '#eab308' } });
  });

  it('maps each layer to a Discover venue with an Atlas reference', () => {
    const venue = atlasRowToVenue('venues', { k: 'oak park restaurant|des moines|IA', n: 'OAK PARK RESTAURANT', c: 'DES MOINES', st: 'IA', vt: 'restaurant', f: 'full', di: 937, ci: 12, pa: 13.25, lat: 41.5867, lng: -93.67 }, origin)!;
    expect(venue).toMatchObject({ id: 'venues:oak park restaurant|des moines|IA', atlas_layer: 'venues', name: 'Oak Park Restaurant', locality: 'Des Moines', venue_type: 'restaurant', drink_items: 937, cocktail_avg_price: 13.25 });
    expect(venue.distance_miles).toBeGreaterThan(2.9);
    expect(venue.distance_miles).toBeLessThan(3.1);
    expect(atlasRowToVenue('stores', { k: 'off:IA:store-5109', n: "CASEY'S GENERAL STORE", c: 'Carlisle', st: 'IA', lt: 'Iowa ABD liquor store (class E)', lat: 41.5, lng: -93.5 }, origin)!.venue_type).toBe('liquor_store');
    expect(atlasRowToVenue('breweries', { k: 'brew:x', n: 'Confluence', bt: 'micro', lat: 41.6, lng: -93.6 }, origin)!.venue_type).toBe('brewery');
    expect(atlasRowToVenue('distill', { k: 'nom:1', kind: 'nom', nom: '1', n: 'X', lat: 20.7, lng: -103.4 }, null)!.venue_type).toBe('distillery');
    expect(atlasRowToVenue('wineries', { k: 'site:9', n: 'W', lat: 38.4, lng: -122.3 }, null)!.venue_type).toBe('winery');
  });

  it('rejects rows without key or coordinates', () => {
    expect(atlasRowToVenue('venues', { n: 'X', lat: 1, lng: 1 }, origin)).toBeNull();
    expect(atlasRowToVenue('venues', { k: 'x', n: 'X', lat: 'nope', lng: 1 }, origin)).toBeNull();
  });

  it('accepts only the six Atlas layers in references', () => {
    expect(ATLAS_REF.test("venues:hall's bar|des moines|IA")).toBe(true);
    expect(ATLAS_REF.test('stores:off:IA:store-1')).toBe(true);
    expect(ATLAS_REF.test('census:50309')).toBe(false);
    expect(ATLAS_REF.test('venues:bad\nref')).toBe(false);
  });
});
