// Harmony Atlas mirror: the same six map layers, keys and colours Harmony Atlas uses (atlas.html ATC / phg_atlas_points),
// read through PHG's public door discover_atlas_points / discover_atlas_clusters (same shared SQL core as Harmony Atlas).
// Pure mapping: no network, no Supabase client. Shared by the app and the discover-checkins Edge Function.
import { haversineMeters, metersToMiles } from './venueCheckin.ts';

export type AtlasLayer = 'venues' | 'licences' | 'stores' | 'distill' | 'wineries' | 'breweries';

/** Exactly Harmony Atlas's layer colours (atlas.html `ATC`) and names. */
export const ATLAS_LAYERS: Record<AtlasLayer, { color: string; label: string }> = {
  venues: { color: '#22d3ee', label: 'On premise' },
  licences: { color: '#c4b5fd', label: 'Licences' },
  stores: { color: '#f59e0b', label: 'Liquor stores' },
  distill: { color: '#f5b54a', label: 'Distilleries' },
  wineries: { color: '#fb7185', label: 'Wineries' },
  breweries: { color: '#eab308', label: 'Breweries' },
};
export const ATLAS_LAYER_ORDER: AtlasLayer[] = ['venues', 'stores', 'breweries', 'distill', 'wineries', 'licences'];
/** Harmony Atlas switches from cluster bubbles to real points at this zoom (atlas.html `ATZ`). */
export const ATLAS_POINT_ZOOM = 9;

export type DiscoverVenue = {
  id: string; name: string;
  venue_type: 'bar'|'restaurant'|'brewery'|'winery'|'distillery'|'cocktail_bar'|'hotel'|'liquor_store'|'other';
  description: string|null; address_line: string|null; locality: string|null; region: string|null;
  postal_code: string|null; latitude: number; longitude: number; distance_miles: number;
  hero_image_url: string|null; website_url: string|null; phone: string|null; verification_status: string;
  /** Which Harmony Atlas layer the record came from. */
  atlas_layer?: AtlasLayer;
  /** Atlas key (`k`) of the record inside its layer. */
  atlas_key?: string;
  /** venues layer: drink items on PHG's captured menu, cocktail count and average cocktail price. */
  drink_items?: number|null; cocktail_items?: number|null; cocktail_avg_price?: number|null;
};
export type AtlasRow = Record<string, unknown>;
export type AtlasPointsPage = { layer: AtlasLayer; total: number; returned: number; capped: boolean; rows: AtlasRow[] };
export type AtlasCluster = { lat: number; lng: number; n: number; m: number; w: number; s: number; e: number; nn: number };

export const isAtlasLayer = (x: unknown): x is AtlasLayer => typeof x === 'string' && x in ATLAS_LAYERS;
export const atlasRef = (layer: AtlasLayer, key: string) => `${layer}:${key}`;
/** Venue reference used by check-ins and the feed: "<atlas layer>:<atlas key>". No control characters. */
export const ATLAS_REF = /^(venues|licences|stores|distill|wineries|breweries):[^\u0000-\u001f]{1,200}$/;

const str = (v: unknown) => (v == null ? '' : String(v)).trim();
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const title = (s: string) => s && s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(\-/&])([a-z])/g, (_m, p, c) => p + c.toUpperCase()) : s;

function venueTypeFor(layer: AtlasLayer, row: AtlasRow): DiscoverVenue['venue_type'] {
  if (layer === 'stores') return 'liquor_store';
  if (layer === 'breweries') return 'brewery';
  if (layer === 'wineries') return 'winery';
  if (layer === 'distill') return 'distillery';
  const t = `${str(row.vt)} ${str(row.f)} ${str(row.lt)}`.toLowerCase();
  if (/hotel/.test(t)) return 'hotel';
  if (/restaurant|full|dining|food/.test(t)) return 'restaurant';
  if (/bar|tavern|pub|lounge|club|nightclub|saloon|on.?premise|liquor|beer|wine/.test(t)) return 'bar';
  return 'other';
}

/** One phg_atlas_points row -> Discover venue, or null when unusable. */
export function atlasRowToVenue(layer: AtlasLayer, row: AtlasRow, origin: { latitude: number; longitude: number } | null): DiscoverVenue | null {
  const lat = Number(row.lat), lng = Number(row.lng), key = str(row.k);
  if (!key || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const meters = origin ? haversineMeters(origin, { latitude: lat, longitude: lng }) : 0;
  const name = title(str(row.n)) || ATLAS_LAYERS[layer].label;
  const description = layer === 'venues' ? (str(row.vt).replace(/_/g, ' ') || 'Venue')
    : layer === 'licences' || layer === 'stores' ? (str(row.lt) || 'Liquor licence')
    : layer === 'breweries' ? (str(row.bt) ? `${str(row.bt)} brewery` : 'Brewery')
    : layer === 'distill' ? (str(row.kind) === 'nom' ? `Tequila producer NOM ${str(row.nom)}` : 'Distillery')
    : 'Winery';
  return {
    id: atlasRef(layer, key), atlas_layer: layer, atlas_key: key,
    name, venue_type: venueTypeFor(layer, row), description,
    address_line: str(row.addr) || null, locality: title(str(row.c ?? row.town)) || null, region: str(row.st) || null, postal_code: null,
    latitude: lat, longitude: lng, distance_miles: Number(metersToMiles(meters).toFixed(2)),
    hero_image_url: null, website_url: str(row.web) || null, phone: null,
    verification_status: str(row.status) || 'source-listed',
    drink_items: num(row.di), cocktail_items: num(row.ci), cocktail_avg_price: num(row.pa),
  };
}
