import { DISCOVER_API_URL, ensureDiscoverSession } from './supabase';

export type DiscoverVenue = {
  id: string; name: string;
  venue_type: 'bar'|'restaurant'|'brewery'|'winery'|'distillery'|'cocktail_bar'|'hotel'|'other';
  description: string|null; address_line: string|null; locality: string|null; region: string|null;
  postal_code: string|null; latitude: number; longitude: number; distance_miles: number;
  hero_image_url: string|null; website_url: string|null; phone: string|null; verification_status: string;
};
export type VenueRadius = 1|5|10|25;

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
  // These are intentionally public client settings (publishable key, never service-role).
  // Environment overrides remain available for staging or future key rotation.
  const base=process.env.EXPO_PUBLIC_PHG_SUPABASE_URL || 'https://lqjtwabzmgjcufftuqvu.supabase.co';
  const key=process.env.EXPO_PUBLIC_PHG_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_nifWfkBSGDpOAbQfmmofzw_C6CKy62T';
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


/** Convert PHG license and brewery records into the existing Atlas map model. */
export async function findNearbyPhgAtlasVenues(latitude:number,longitude:number,radius:VenueRadius,venueType?:string|null):Promise<DiscoverVenue[]> {
  const latDelta=radius/69;
  const lngDelta=radius/(69*Math.max(Math.cos(latitude*Math.PI/180),0.15));
  const bounds={minLat:Math.max(-90,latitude-latDelta),maxLat:Math.min(90,latitude+latDelta),minLng:Math.max(-180,longitude-lngDelta),maxLng:Math.min(180,longitude+lngDelta)};
  const datasets:PhgAtlasDataset[] = venueType==='brewery'?['breweries']:venueType==='winery'?['wineries']:venueType==='distillery'?['distilleries']:venueType==='bar'||venueType==='cocktail_bar'||venueType==='restaurant'?['licenses']:['licenses','breweries','wineries','distilleries'];
  const pages=await Promise.all(datasets.map(dataset=>fetchPhgAtlasDataset(dataset,{limit:250,bounds})));
  const result:DiscoverVenue[]=[];
  for(const page of pages){
    for(const row of page.records){
      const isLicense=page.dataset==='licenses';
      const isProductionSite=page.dataset==='wineries'||page.dataset==='distilleries';
      const lat=Number(row.latitude);
      const lng=Number(row.longitude);
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat < bounds.minLat||lat > bounds.maxLat||lng < bounds.minLng||lng > bounds.maxLng) continue;
      if(isLicense && row.on_premise!==true) continue;
      const name=String(isLicense?row.business_name??'Unnamed license':isProductionSite?row.site_name??'Unnamed production site':row.name??'Unnamed brewery');
      const type:DiscoverVenue['venue_type']=isLicense?(String(row.license_type||'').toLowerCase().includes('restaurant')?'restaurant':'bar'):page.dataset==='wineries'?'winery':page.dataset==='distilleries'?'distillery':'brewery';
      if(venueType && venueType!==type && !(venueType==='cocktail_bar'&&type==='bar')) continue;
      const miles=111.045*Math.acos(Math.min(1,Math.max(-1,Math.sin(latitude*Math.PI/180)*Math.sin(lat*Math.PI/180)+Math.cos(latitude*Math.PI/180)*Math.cos(lat*Math.PI/180)*Math.cos((lng-longitude)*Math.PI/180))));
      if(miles>radius) continue;
      result.push({
        id:`${page.dataset}:${String(isLicense?row.state+'-'+row.license_no:isProductionSite?row.site_id:row.obdb_id)}`,
        name,venue_type:type,description:isLicense?String(row.license_type||'Liquor license'):isProductionSite?String(row.site_type||'Production site'):String(row.brewery_type||'Brewery'),
        address_line:isLicense?String(row.address||''):String(row.street||row.location_address||''),
        locality:String(row.city||''),region:String(row.state||''),postal_code:String(row.zip||row.postal_code||''),
        latitude:lat,longitude:lng,distance_miles:Number(miles.toFixed(2)),
        hero_image_url:null,website_url:isLicense?null:String(isProductionSite?row.official_website:row.website_url||'')||null,
        phone:isLicense?null:String(row.phone||'')||null,verification_status:isLicense?String(row.status||'unknown'):isProductionSite?String(row.site_status||row.match_status||'source-listed'):'source-listed'
      });
    }
  }
  return result.sort((a,b)=>a.distance_miles-b.distance_miles).slice(0,250);
}
