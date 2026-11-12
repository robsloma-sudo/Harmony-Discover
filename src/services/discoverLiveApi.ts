import { ensureDiscoverSession } from './supabase';

const base = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

export type BottleState = 'matched' | 'reported' | 'unsure';
export type BottleEdgePath = {
  kind: 'hard' | 'label' | 'print';
  points: Array<{ x: number; y: number }>;
  confidence: number;
  inferred?: boolean;
};
export type BottleRead = {
  box: { x0: number; y0: number; x1: number; y1: number };
  label_box?: { x0: number; y0: number; x1: number; y1: number } | null;
  edgePaths?: BottleEdgePath[];
  words: string[];
  brand: string; product: string; category: string;
  proof: string; size: string; origin: string; confidence: number;
  fieldConfidence: Record<string, number>;
  researchSources: Array<{ url: string; title: string; supports: string[]; source_type: string }>;
  details: Record<string, string | string[]>;
  match: { id: string; brand: string | null; product: string | null; score: number } | null;
  state: BottleState;
};
export class BottleReadError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function call(body: Record<string, unknown>) {
  if (!base || !publishableKey) throw new BottleReadError('not_configured', 0);
  const session = await ensureDiscoverSession();
  const response = await fetch(`${base}/functions/v1/discover-live-read`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}`, apikey: publishableKey },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new BottleReadError(String(json.error || 'request_failed'), response.status);
  return json;
}

export type MenuGlimpse = { visible: boolean; title: string; box?: { x0: number; y0: number; x1: number; y1: number } | null; items: Array<{ name: string; price: string; type: string }> };
export type LiveRead = { bottles: BottleRead[]; menu: MenuGlimpse; diagnostics: { version: string; model: string; providerMs: number; bottlesReturned: number; bottlesConfident: number; bottlesMatched: number } };

/** One camera frame (JPEG, base64) in; every readable bottle label and any menu in view out. Nothing is stored. */
export async function readLiveFrame(jpegBase64: string, focus: 'standard' | 'fine_print' = 'standard'): Promise<LiveRead> {
  const result = await call({ action: 'frame', image: jpegBase64, focus });
  const menu = result.menu && typeof result.menu === 'object' ? result.menu as MenuGlimpse : { visible: false, title: '', items: [] };
  const bottles = Array.isArray(result.bottles) ? result.bottles.map((b: Record<string, unknown>) => ({ ...b, researchSources: Array.isArray(b.research_sources) ? b.research_sources : [] })) as BottleRead[] : [];
  const d = result.diagnostics && typeof result.diagnostics === 'object' ? result.diagnostics : {};
  return { bottles, menu: { visible: !!menu.visible, title: menu.title || '', items: Array.isArray(menu.items) ? menu.items : [] }, diagnostics: { version: String(d.version || result.version || 'unknown'), model: String(d.model || result.model || 'unknown'), providerMs: Number(d.provider_ms) || 0, bottlesReturned: Number(d.bottles_returned) || bottles.length, bottlesConfident: Number(d.bottles_confident) || 0, bottlesMatched: Number(d.bottles_matched) || 0 } };
}

/** Saves the bottles the person kept as sightings. */
export async function saveBottleSightings(scanSessionId: string, venueName: string, bottles: BottleRead[]): Promise<{ saved: number; matched: number; enriched: Array<Partial<BottleRead> & { brand: string; product: string; fieldConfidence: Record<string,number>; researchSources: Array<{url:string;title:string;supports:string[];source_type:string}> }> }> {
  const result = await call({
    action: 'save', scan_session_id: scanSessionId, venue_name: venueName,
    bottles: bottles.map(b => ({ brand: b.match?.brand || b.brand, product: b.product, category: b.category, proof: b.proof, size: b.size, words: b.words, confidence: b.confidence, details: b.details, field_confidence: b.fieldConfidence, research_sources: b.researchSources })),
  });
  const enriched = Array.isArray(result.enriched_bottles) ? result.enriched_bottles.map((b: Record<string,unknown>) => ({
    brand: String(b.brand || ''), product: String(b.product || ''),
    category: String(b.category || ''), proof: String(b.proof || ''), size: String(b.size || ''),
    details: (b.details && typeof b.details === 'object' ? b.details : {}) as Record<string,string|string[]>,
    fieldConfidence: (b.field_confidence && typeof b.field_confidence === 'object' ? b.field_confidence : {}) as Record<string,number>,
    researchSources: Array.isArray(b.research_sources) ? b.research_sources : [],
  })) : [];
  return { saved: Number(result.saved) || 0, matched: Number(result.matched) || 0, enriched };
}

export function bottleErrorMessage(error: unknown): string {
  const code = error instanceof BottleReadError ? error.message : '';
  if (code === 'daily_limit_reached') return "You've reached today's scan limit. It resets at midnight UTC.";
  if (code === 'rate_limited') return 'Scanning too fast. Hold steady for a moment.';
  if (code === 'not_configured') return "The scanner isn't connected yet.";
  if (code === 'origin_not_allowed') return "This address isn't allowed to scan yet.";
  if (code === 'unauthorized') return 'Your session expired. Reload the page.';
  return "Couldn't read that view. Trying again.";
}
