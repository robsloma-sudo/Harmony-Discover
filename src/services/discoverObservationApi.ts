import { DISCOVER_API_URL } from './supabase';
import { supabase } from './supabase';
import * as ImageManipulator from 'expo-image-manipulator';

export type DiscoveredMenuItem = {
  id: string; page: number; section: string | null; name: string; description: string | null;
  price: string | null; category: string; listed_ingredients: string[]; evidence: string; text_verified: boolean;
};
export type ObservationResult = {
  id: string; status: string; pages: number; venue_name_read: string | null; read_at: string | null;
  quality: { all_pages_complete: boolean | null; min_confidence: number | null };
  items: DiscoveredMenuItem[];
};

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in to process this menu.');
  return { authorization: `Bearer ${token}`, apikey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '' };
}
async function request(path: string, init: RequestInit = {}) {
  if (!DISCOVER_API_URL) throw new Error('Discover API is not configured.');
  const headers = await authHeaders();
  const response = await fetch(`${DISCOVER_API_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Discover request failed (${response.status}).`);
  return body;
}

export async function processMenuPhotos(uris: string[], source: 'camera' | 'gallery'): Promise<ObservationResult> {
  if (!uris.length) throw new Error('Choose at least one menu photo.');
  const created = await request('/v1/observations', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ processingNoticeVersion: 'discover-menu-processing-v1', source }),
  });
  const id = String(created.id);
  for (const [index, uri] of uris.entries()) {
    // Normalize every selected image to JPEG. This also handles iPhone HEIC/HEIF photos.
    const converted = await ImageManipulator.manipulateAsync(uri, [], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
    const response = await fetch(converted.uri);
    const blob = await response.blob();
    const form = new FormData();
    form.append('file', blob, `menu-page-${index + 1}.jpg`);
    await request(`/v1/observations/${id}/assets`, { method: 'POST', body: form });
  }
  await request(`/v1/observations/${id}/complete`, { method: 'POST' });
  const readResult = await request(`/v1/observations/${id}/read`, { method: 'POST' });
  const observation = await request(`/v1/observations/${id}`) as ObservationResult;
  if (!readResult.ok && !observation.items?.length) {
    const firstFailure = readResult.failures?.[0]?.error;
    throw new Error(firstFailure ? `Menu reader could not process this photo (${firstFailure}).` : 'Menu reader did not return any items. Try a clearer photo.');
  }
  return observation;
}


export type MenuItemCorrection = { name?:string; section?:string|null; description?:string|null; price?:string|null; category?:'cocktail'|'wine'|'beer'|'spirits'|'non_alcoholic'|'food'|'other' };
export async function saveMenuItemCorrection(observationId:string,itemId:string,changes:MenuItemCorrection):Promise<DiscoveredMenuItem>{const result=await request(`/v1/observations/${observationId}/items/${itemId}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({changes})});if(!result.saved||!result.item)throw new Error('Correction was not saved.');return result.item as DiscoveredMenuItem}
