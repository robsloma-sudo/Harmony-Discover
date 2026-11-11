import { supabase } from './supabase';

export type DiscoverVenue = {
  id: string;
  name: string;
  venue_type: 'bar'|'restaurant'|'brewery'|'winery'|'distillery'|'cocktail_bar'|'hotel'|'other';
  description: string|null;
  address_line: string|null;
  locality: string|null;
  region: string|null;
  postal_code: string|null;
  latitude: number;
  longitude: number;
  distance_miles: number;
  hero_image_url: string|null;
  website_url: string|null;
  phone: string|null;
  verification_status: string;
};

export type VenueRadius = 1|5|10|15|20;

export async function findNearbyVenues(latitude:number, longitude:number, radius:VenueRadius, venueType?:string|null) {
  const {data,error}=await supabase.rpc('discover_nearby_venues',{
    p_latitude:latitude,
    p_longitude:longitude,
    p_radius_miles:radius,
    p_venue_type:venueType || null,
    p_limit:150
  });
  if(error) throw new Error(error.message);
  return (data || []) as DiscoverVenue[];
}
