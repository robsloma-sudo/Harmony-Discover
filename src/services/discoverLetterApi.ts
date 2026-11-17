/**
 * Letter catalogue lookups for the instant "Probably …" hint, and scan-timing records.
 * Both run as the signed-in (silent, anonymous) Discover session against the Discover database.
 */
import { ensureDiscoverSession } from './supabase';
import type { FragmentMatch, LetterMatch } from '../live/letterGuess';
import type { NameCandidate } from '../live/partialEvidence';

const base = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

async function rpc<T>(name: string, args: Record<string, unknown>, timeoutMs = 2_500): Promise<T> {
  if (!base || !publishableKey) throw new Error('not_configured');
  const session = await ensureDiscoverSession();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}`, apikey: publishableKey },
      body: JSON.stringify(args),
      signal: controller?.signal,
    });
    if (!response.ok) throw new Error(`${name}_failed_${response.status}`);
    return await response.json() as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const toNumber = (value: unknown) => Number(value) || 0;

/** Brands whose letters match the words (any order; one misread allowed). */
export async function letterLookup(words: string[], limit = 5): Promise<LetterMatch[]> {
  if (!words.length) return [];
  const rows = await rpc<Array<Record<string, unknown>>>('discover_letter_lookup', { p_words: words.slice(0, 6), p_limit: limit });
  return (rows || []).map(row => ({
    brand: String(row.brand ?? ''), score: toNumber(row.score), matched_words: toNumber(row.matched_words),
    exact_hits: toNumber(row.exact_hits), labels: toNumber(row.labels),
  })).filter(row => row.brand);
}

/** Brands whose letters contain the part-words a curved label let the phone read. */
export async function fragmentLookup(fragments: string[], limit = 5): Promise<FragmentMatch[]> {
  if (!fragments.length) return [];
  const rows = await rpc<Array<Record<string, unknown>>>('discover_fragment_lookup', { p_fragments: fragments.slice(0, 6), p_limit: limit });
  return (rows || []).map(row => ({
    brand: String(row.brand ?? ''), score: toNumber(row.score), labels: toNumber(row.labels),
    fragments_matched: toNumber(row.fragments_matched), coverage: toNumber(row.coverage),
  })).filter(row => row.brand);
}

/**
 * Names (label approvals and the Harmony catalogue) containing any of the part-words a partly hidden label showed,
 * across brand and product. Candidates only: the app scores them (see partialEvidence.ts).
 */
export async function partialLookup(anchors: string[], limit = 150): Promise<NameCandidate[]> {
  if (!anchors.length) return [];
  const rows = await rpc<Array<Record<string, unknown>>>('discover_partial_lookup', { p_anchors: anchors.slice(0, 6), p_limit: limit }, 4_000);
  return (rows || []).map(row => ({
    brand: String(row.brand ?? ''), product: String(row.product ?? ''), classType: row.class_type == null ? null : String(row.class_type),
    labels: toNumber(row.labels), source: row.source === 'harmony' ? 'harmony' as const : 'label' as const,
  })).filter(row => row.brand);
}

export type ScanTimingRow = {
  scan_session_id: string;
  track_id: string;
  named_by: 'letters' | 'partial' | 'ai_label' | 'none';
  ms_to_text?: number | null;
  ms_to_name?: number | null;
  ms_to_confirm?: number | null;
  brand?: string | null;
  product?: string | null;
  label_px?: number | null;
  zoom?: number | null;
  device?: string | null;
  app_version?: string | null;
  guess_brand?: string | null;
  guess_agreed?: boolean | null;
  ocr_ms?: number | null;
  ocr_words?: string[];
  /** The label was partly hidden or cut off at some read. */
  partial?: boolean | null;
  /** Where the first "Probably …" came from. */
  guess_source?: 'letters' | 'partial' | null;
  verify_calls?: number | null;
  verify_verdict?: 'match' | 'none' | 'error' | null;
};

/** Records how fast bottles were named (no photos). At most 50 rows per call. */
export async function logScanTimings(rows: ScanTimingRow[]): Promise<number> {
  if (!rows.length) return 0;
  return rpc<number>('discover_log_scan_timings', { p_rows: rows.slice(0, 50) }, 5_000);
}
