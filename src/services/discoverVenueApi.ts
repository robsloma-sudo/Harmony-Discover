import { DISCOVER_API_URL, ensureDiscoverSession } from './supabase';
import { boundsAround } from './venueCheckin';
import { atlasRowToVenue, type AtlasCluster, type AtlasLayer, type AtlasPointsPage, type DiscoverVenue } from './phgAtlasRecords';
export { atlasRowToVenue, ATLAS_LAYERS, ATLAS_LAYER_ORDER, ATLAS_POINT_ZOOM, type AtlasCluster, type AtlasLayer, type AtlasPointsPage, type DiscoverVenue } from './phgAtlasRecords';

export type VenueRadius = number;

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


const PHG_URL=(process.env.EXPO_PUBLIC_PHG_SUPABASE_URL || 'https://lqjtwabzmgjcufftuqvu.supabase.co').replace(/\/$/,'');
// Public client settings (publishable key, never service-role).
const PHG_KEY=process.env.EXPO_PUBLIC_PHG_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_nifWfkBSGDpOAbQfmmofzw_C6CKy62T';
type Bounds={minLat:number;minLng:number;maxLat:number;maxLng:number};

async function phgRpc<T>(name:string,body:unknown):Promise<T>{
  const response=await fetch(`${PHG_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{'content-type':'application/json',apikey:PHG_KEY,authorization:`Bearer ${PHG_KEY}`},body:JSON.stringify(body)});
  const payload=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(payload?.message||`Atlas request failed (${response.status}).`);
  return payload as T;
}

/** Harmony Atlas points for one layer (same SQL core as Harmony Atlas). Bounds must be <= 3 degrees each way. */
export async function fetchAtlasPoints(layer:AtlasLayer,b:Bounds,limit=500):Promise<AtlasPointsPage>{
  const page=await phgRpc<AtlasPointsPage>('discover_atlas_points',{p_layer:layer,p_west:b.minLng,p_south:b.minLat,p_east:b.maxLng,p_north:b.maxLat,p_limit:Math.min(Math.max(limit,1),1000)});
  if(!page||page.layer!==layer||!Array.isArray(page.rows)) throw new Error('Atlas returned an invalid response.');
  return page;
}

/** Harmony Atlas cluster bubbles for one layer (used below zoom 9, exactly like Harmony Atlas). */
export async function fetchAtlasClusters(layer:AtlasLayer,b:Bounds,zoom:number,menuOnly=false):Promise<{total:number;cells:AtlasCluster[]}>{
  const res=await phgRpc<{total:number;cells:AtlasCluster[]|null}>('discover_atlas_clusters',{p_layer:layer,p_west:b.minLng,p_south:b.minLat,p_east:b.maxLng,p_north:b.maxLat,p_zoom:zoom,p_f:menuOnly?{menu:true}:{}});
  return {total:Number(res?.total)||0,cells:Array.isArray(res?.cells)?res!.cells!:[]};
}

/** Layers a Nearby category filter maps onto (Harmony Atlas layer names). */
export function layersForCategory(venueType?:string|null):AtlasLayer[]{
  if(venueType==='brewery')return['breweries'];
  if(venueType==='winery')return['wineries'];
  if(venueType==='distillery')return['distill'];
  if(venueType==='liquor_store')return['stores'];
  if(venueType==='bar'||venueType==='cocktail_bar'||venueType==='restaurant')return['venues'];
  return['venues','stores','breweries','distill','wineries'];
}

/** Nearby list: Harmony Atlas records inside the radius, nearest first. */
export async function findNearbyPhgAtlasVenues(latitude:number,longitude:number,radius:VenueRadius,venueType?:string|null):Promise<DiscoverVenue[]> {
  const origin={latitude,longitude};
  const bounds=boundsAround(origin,radius*1609.344);
  const pages=await Promise.all(layersForCategory(venueType).map(layer=>fetchAtlasPoints(layer,bounds,1000).catch(()=>null)));
  const result:DiscoverVenue[]=[];
  for(const page of pages){
    if(!page) continue;
    for(const row of page.rows){
      const v=atlasRowToVenue(page.layer,row,origin);
      if(!v||v.distance_miles>radius) continue;
      if(venueType==='restaurant'&&v.venue_type!=='restaurant') continue;
      if((venueType==='bar'||venueType==='cocktail_bar')&&v.venue_type==='restaurant') continue;
      result.push(v);
    }
  }
  return result.sort((a,b)=>a.distance_miles-b.distance_miles).slice(0,400);
}

/** Check-in candidates: every Harmony Atlas layer a person could be standing in (venues, stores, producers). */
export async function findCheckinVenues(latitude:number,longitude:number,searchRadiusM:number):Promise<DiscoverVenue[]>{
  const origin={latitude,longitude};
  const bounds=boundsAround(origin,searchRadiusM);
  const pages=await Promise.all((['venues','licences','stores','breweries','distill','wineries'] as AtlasLayer[]).map(layer=>fetchAtlasPoints(layer,bounds,100).catch(()=>null)));
  const out:DiscoverVenue[]=[];
  for(const page of pages){ if(!page) continue; for(const row of page.rows){ const v=atlasRowToVenue(page.layer,row,origin); if(v) out.push(v); } }
  return out;
}

export type MenuPagesView = { type:'menu_pages'|'empty'; title?:string; city?:string; state?:string; pages?:Array<{n:number;url:string;width:number|null;height:number|null;scope:string;page:number;source:string}>; note?:string };
/** The venue's captured menu pages, from the same source the Harmony Atlas venue card uses. */
export async function fetchVenueMenuPages(venue:{name:string;locality:string|null;region:string|null}):Promise<MenuPagesView>{
  const response=await fetch(`${PHG_URL}/functions/v1/phg-discover-menu-pages`,{method:'POST',headers:{'content-type':'application/json',apikey:PHG_KEY},body:JSON.stringify({q:venue.name,city:venue.locality||'',state:venue.region||'',limit:24})});
  const body=await response.json().catch(()=>null);
  if(!response.ok||!body?.ok) throw new Error('Menu pages could not load just now.');
  return body.view as MenuPagesView;
}

// ---- Venue check-ins and the public venue feed (discover-api, Discover DEV) ----

export type CheckinTrigger = 'bottle_scan'|'menu_scan'|'live_scan'|'manual';
export type CheckinSelection = 'suggested'|'chosen_from_list'|'searched';
export type VenueCheckin = { checkinId:string; venueRef:string; venueName:string; venueType:string; distanceM:number; expiresAt:string; shareScans:boolean; attached:{bottles:number;menus:number} };
export type VenueFeed = {
  venue: { ref:string; name:string; venue_type:string; locality:string|null; region:string|null; latitude:number; longitude:number }|null;
  bottles: Array<{ brand:string; product:string|null; category:string|null; size:string|null; last_seen_at:string; first_seen_at:string; sightings:number; people:number }>;
  menus: Array<{ observation_id:string; captured_at:string; items:Array<{ section:string|null; name:string; price:string|null; category:string|null }> }>;
  contributors: number; window_days: number; note?: string;
};

/** Venue check-ins live in their own small DEV Edge Function, next to discover-api. */
const DISCOVER_CHECKINS_URL = DISCOVER_API_URL ? DISCOVER_API_URL.replace(/\/discover-api$/, '/discover-checkins') : '';
async function discoverApi(path:string, init:RequestInit={}){
  if (!DISCOVER_CHECKINS_URL) throw new Error('Discover API is not configured.');
  const session = await ensureDiscoverSession();
  const response = await fetch(`${DISCOVER_CHECKINS_URL}${path}`, { ...init, headers:{ authorization:`Bearer ${session.access_token}`, apikey:process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '', ...(init.body?{'content-type':'application/json'}:{}), ...(init.headers||{}) } });
  const body = await response.json().catch(()=>({}));
  return { response, body };
}

const CHECKIN_ERRORS:Record<string,string> = {
  checkins_not_configured:'Check-ins are not switched on yet.',
  venue_not_nearby:'That venue is not close enough to where you are.',
  location_too_inaccurate:'Your location is too rough to check in. Try again outside or with Wi-Fi on.',
  rate_limited:'Too many check-ins in a short time. Try again later.',
  atlas_unavailable:'The venue map is not answering right now.',
};

/** Confirm a check-in. The device fix is sent only so the server can check distance; it is not stored. */
export async function recordVenueCheckin(input:{ venueRef:string; device:{latitude:number;longitude:number;accuracyM:number}; trigger:CheckinTrigger; selection:CheckinSelection; shareScans:boolean }):Promise<VenueCheckin>{
  const { response, body } = await discoverApi('/v1/checkins', { method:'POST', body:JSON.stringify(input) });
  if (!response.ok) throw new Error(CHECKIN_ERRORS[body.error] || body.error || `Check-in failed (${response.status}).`);
  return body as VenueCheckin;
}

export async function withdrawVenueCheckin(checkinId:string):Promise<void>{
  const { response, body } = await discoverApi(`/v1/checkins/${encodeURIComponent(checkinId)}`, { method:'DELETE' });
  if (!response.ok) throw new Error(body.error || `Could not undo the check-in (${response.status}).`);
}

export async function fetchVenueFeed(venueRef:string, days=90):Promise<VenueFeed>{
  const { response, body } = await discoverApi(`/v1/venues/feed?ref=${encodeURIComponent(venueRef)}&days=${days}`);
  if (!response.ok) throw new Error(body.error==='checkins_not_configured'?'Crowd updates are not switched on yet.':(body.error || `Venue feed failed (${response.status}).`));
  return body as VenueFeed;
}

// ---- Google Street View (same Maps Embed key as Harmony Atlas, via PHG; the Embed API has no usage charge) ----
let streetViewKey: Promise<string> | null = null;
export function getStreetViewKey(): Promise<string> {
  if (!streetViewKey) {
    streetViewKey = fetch(`${PHG_URL}/functions/v1/phg-discover-menu-pages`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: PHG_KEY }, body: JSON.stringify({ op: 'streetview' }) })
      .then(r => r.json()).then(j => (j?.ok && typeof j.key === 'string' ? j.key : ''))
      .catch(() => '');
    streetViewKey.then(k => { if (!k) streetViewKey = null; });
  }
  return streetViewKey;
}
/** Interactive Street View for a point, embedded in the page (no redirect). */
export const streetViewEmbedUrl = (key: string, latitude: number, longitude: number, heading = 0) =>
  `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(key)}&location=${latitude.toFixed(6)},${longitude.toFixed(6)}&fov=85&heading=${Math.round(heading)}&pitch=0`;
/** Same spot in Google Maps (only used where an embed is impossible, e.g. the native app). */
export const streetViewAppUrl = (latitude: number, longitude: number) =>
  `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
