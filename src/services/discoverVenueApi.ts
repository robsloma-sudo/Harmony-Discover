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


export type PhgAtlasDataset = 'licenses'|'breweries'|'distilleries'|'wineries';
export type PhgAtlasRecord = Record<string, string|number|boolean|null>;
export type PhgAtlasPage = { dataset:PhgAtlasDataset; total:number; limit:number; offset:number; has_more:boolean; records:PhgAtlasRecord[]; coverage:string };

/**
 * PHG public-key bridge. The database RPC is explicitly allowlisted to four
 * public business datasets and returns bounded, projected columns only.
 * Never put a PHG service-role key in the app.
 */
export async function fetchPhgAtlasDataset(
  dataset:PhgAtlasDataset,
  options:{limit?:number;offset?:number;bounds?:{minLat:number;minLng:number;maxLat:number;maxLng:number}}={}
):Promise<PhgAtlasPage>{
  const base=process.env.EXPO_PUBLIC_PHG_SUPABASE_URL;
  const key=process.env.EXPO_PUBLIC_PHG_SUPABASE_PUBLISHABLE_KEY;
  if(!base||!key) throw new Error('PHG Atlas public bridge is not configured in this Discover build.');
  const b=options.bounds;
  const response=await fetch(`${base.replace(/\/$/,'')}/rest/v1/rpc/discover_atlas_data_bridge`,{
    method:'POST',
    headers:{'content-type':'application/json',apikey:key,authorization:`Bearer ${key}`},
    body:JSON.stringify({
      p_dataset:dataset,
      p_min_lat:b?.minLat??null,p_min_lng:b?.minLng??null,
      p_max_lat:b?.maxLat??null,p_max_lng:b?.maxLng??null,
      p_limit:Math.min(Math.max(options.limit??100,1),250),
      p_offset:Math.max(options.offset??0,0)
    })
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(payload?.message||payload?.hint||`PHG Atlas bridge failed (${response.status}).`);
  if(!payload||payload.dataset!==dataset||!Array.isArray(payload.records)) throw new Error('PHG Atlas bridge returned an invalid response.');
  return payload as PhgAtlasPage;
}
