// The ONLY place that knows the server program name and its action names (PR #128 discover-explore).
// Command names behind #128 may still change: edit this file, nothing else.
import { ensureDiscoverSession } from '../supabase';
import { GUEST_LIMIT_MESSAGE } from './types';

export const EXPLORE_FUNCTION = 'discover-explore';
export const EXPLORE_ACTIONS = {
  linkMenu: 'link_menu',
  changeCocktail: 'change_cocktail',
  journey: 'journey',
  tap: 'tap',
  saveVersion: 'save_version',
  listVersions: 'list_versions',
  deleteVersion: 'delete_version',
} as const;
export type ExploreActionName = (typeof EXPLORE_ACTIONS)[keyof typeof EXPLORE_ACTIONS];

export class ExploreRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string = '') { super(message); this.name = 'ExploreRequestError'; }
}
export class ExploreLimitError extends ExploreRequestError {
  constructor(message: string, status: number, code: string, readonly reason: 'guest_daily' | 'versions_full') {
    super(message, status, code); this.name = 'ExploreLimitError';
  }
}

/** Single POST {action, ...body} to the discover-explore server program. Env is read here, per call. */
export async function callExplore(action: ExploreActionName, body: Record<string, unknown> = {}): Promise<any> {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  if (!base) throw new ExploreRequestError('Explore is not configured.', 0, 'not_configured');
  const session = await ensureDiscoverSession();
  const response = await fetch(`${base}/functions/v1/${EXPLORE_FUNCTION}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.access_token}`,
      apikey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action, ...body }),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof data?.error === 'string' ? data.error : '';
    const message = typeof data?.message === 'string' && data.message ? data.message : '';
    if (response.status === 429 && code === 'daily_limit_reached') throw new ExploreLimitError(message || GUEST_LIMIT_MESSAGE, 429, code, 'guest_daily');
    if (response.status === 409 && code === 'versions_full') throw new ExploreLimitError(message || 'Your saved versions are full.', 409, code, 'versions_full');
    throw new ExploreRequestError(message || code || `Explore request failed (${response.status}).`, response.status, code);
  }
  return data;
}
