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
class DiscoverRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request(path: string, init: RequestInit = {}) {
  if (!DISCOVER_API_URL) throw new Error('Discover API is not configured.');
  const headers = await authHeaders();
  const response = await fetch(`${DISCOVER_API_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new DiscoverRequestError(body.error || `Discover request failed (${response.status}).`, response.status);
  return body;
}

async function uploadPageWithRetry(observationId: string, blob: Blob, pageNumber: number) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // Rebuild the request per attempt; browsers may consume multipart request bodies.
      const retryForm = new FormData();
      retryForm.append('file', blob, `menu-page-${pageNumber}.jpg`);
      await request(`/v1/observations/${observationId}/assets`, { method: 'POST', body: retryForm });
      return;
    } catch (error) {
      lastError = error;
      const status = error instanceof DiscoverRequestError ? error.status : 0;
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt === 2) break;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  const reason = lastError instanceof Error ? lastError.message : 'network error';
  throw new Error(`Could not upload menu page ${pageNumber} after retries: ${reason}`);
}

export type MenuProcessingProgress = (message: string) => void;

export async function processMenuPhotos(uris: string[], source: 'camera' | 'gallery', onProgress?: MenuProcessingProgress): Promise<ObservationResult> {
  if (!uris.length) throw new Error('Choose at least one menu photo.');

  onProgress?.('Preparing your photos…');
  // Convert every page first so a local image-conversion failure cannot create
  // an empty or partially populated observation on the server.
  const preparedForms = await Promise.all(uris.map(async (uri, index) => {
    const converted = await ImageManipulator.manipulateAsync(uri, [], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
    const response = await fetch(converted.uri);
    const blob = await response.blob();
    return blob;
  }));

  const created = await request('/v1/observations', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ processingNoticeVersion: 'discover-menu-processing-v1', source }),
  });
  const id = String(created.id);
  try {
    for (const [index, blob] of preparedForms.entries()) {
      onProgress?.(`Uploading page ${index + 1} of ${preparedForms.length}…`);
      await uploadPageWithRetry(id, blob, index + 1);
    }
  } catch (uploadError) {
    // Best-effort cleanup prevents a partial upload from lingering in DEV.
    try { await request(`/v1/observations/${id}`, { method: 'DELETE' }); }
    catch { /* Keep the original page-upload error visible to the user. */ }
    throw uploadError;
  }
  onProgress?.('Reading the menu…');
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


export type ObservationContributionPermission = { granted: boolean; policyVersion: string | null; grantedAt: string | null };
export async function getObservationContribution(observationId: string): Promise<ObservationContributionPermission> {
  return request(`/v1/observations/${observationId}/contribution`) as Promise<ObservationContributionPermission>;
}
export async function grantObservationContribution(observationId: string): Promise<void> {
  await request(`/v1/observations/${observationId}/contribution`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ policyVersion: 'discover-harmony-contribution-v1' }),
  });
}
export async function withdrawObservationContribution(observationId: string): Promise<void> {
  await request(`/v1/observations/${observationId}/contribution`, { method: 'DELETE' });
}
