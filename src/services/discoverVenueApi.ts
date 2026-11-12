import { DISCOVER_API_URL, ensureDiscoverSession } from './supabase';

export type DiscoverVenue = {
  id: string; name: string;
  venue_type: 'bar'|'restaurant'|'brewery'|'winery'|'distillery'|'cocktail_bar'|'hotel'|'other';
  description: string|null; address_line: string|null; locality: string|null; region: string|null;
  postal_code: string|null; latitude: number; longitude: number; distance_miles: number;
  hero_image_url: string|null; website_url: string|null; phone: string|null; verification_status: string;
};
export type VenueRadius = 1|5|10|15|20;

export async function findNearbyVenues(latitude:number, longitude:number, radius:VenueRadius, venueType?:string|null) {
  if (!DISCOVER_API_URL) throw new Error('Discover API is not configured.');
  const session = await ensureDiscoverSession();
  const params = new URLSearchParams({ latitude:String(latitude), longitude:String(longitude), radius_miles:String(radius) });
  if (venueType) params.set('venue_type', venueType);
  const response = await fetch(`${DISCOVER_API_URL}/v1/atlas/venues?${params.toString()}`, {
    method:'GET', headers:{ authorization:`Bearer ${session.access_token}`, apikey:process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '' }
  });
  const body = await response.json().catch(()=>({}));
  if (!response.ok) {
    if (response.status === 503 && body.error === 'atlas_bridge_not_configured') throw new Error('Harmony Atlas data connection is being configured. The map is available, but venue intelligence is not connected yet.');
    throw new Error(body.error || `Atlas request failed (${response.status}).`);
  }
  if (!Array.isArray(body.venues)) throw new Error('Atlas returned an invalid venue response.');
  return body.venues as DiscoverVenue[];
}
