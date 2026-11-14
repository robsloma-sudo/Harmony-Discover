import type { BottleRead } from '../services/discoverLiveApi';
import { identityKey, sameBottleIdentity } from './trackEvidence';

/** One identified product in the "found" strip at the top of the scanner. */
export type FoundItem = {
  key: string;
  name: string;
  bottle: BottleRead;
  trackIds: number[];
  firstSeenAt: number;
  /** Goes up each time a later read adds or changes facts (drives the "new data" dot). */
  version: number;
};

export type FoundCandidate = {
  trackId: number; x: number; y: number; width: number; height: number;
  bottle?: BottleRead;
};

/** What the bottle's facts are, so a re-read that adds nothing does not count as new data. */
export function foundFacts(bottle: BottleRead): string {
  const details = bottle.details && typeof bottle.details === 'object' ? bottle.details : {};
  const filled = Object.keys(details).filter(key => {
    const value = (details as Record<string, unknown>)[key];
    return Array.isArray(value) ? value.length > 0 : !!String(value ?? '').trim();
  }).sort();
  return [bottle.match?.brand || bottle.brand, bottle.match?.product || bottle.product, bottle.proof, bottle.size, bottle.origin, bottle.category,
    ...filled.map(key => key + '=' + String((details as Record<string, unknown>)[key]))].map(v => String(v ?? '').trim().toLowerCase()).join('|');
}

const GENERIC = new Set(['straight', 'kentucky', 'tennessee', 'bourbon', 'whiskey', 'whisky', 'bottled', 'in', 'bond', 'of', 'the', 'and', 'colonel', 'jr', 'sr', 'year', 'years', 'old', 'aged']);
const words = (value?: string | null) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
/**
 * One product, even when reads word it differently ("Single Barrel" vs
 * "Single Barrel Straight Kentucky Bourbon Whiskey"): same brand, and the
 * shorter expression's words are all in the longer one. "Single Barrel" and
 * "Cured Oak" stay separate.
 */
export function sameFoundProduct(a: BottleRead, b: BottleRead): boolean {
  if (a.match?.id && b.match?.id) return a.match.id === b.match.id;
  if (!sameBottleIdentity(a, b)) return false;
  const brandWords = new Set([...words(a.match?.brand || a.brand), ...words(b.match?.brand || b.brand)]);
  const expression = (r: BottleRead) => new Set(words(r.match?.product || r.product).filter(w => !brandWords.has(w) && !GENERIC.has(w)));
  const x = expression(a), y = expression(b);
  if (!x.size || !y.size) return x.size === y.size;
  const [small, large] = x.size <= y.size ? [x, y] : [y, x];
  return [...small].every(w => large.has(w));
}

/** Brand + expression, without repeating the brand when the expression already names it. */
export function displayName(brand?: string | null, product?: string | null): string {
  const b = String(brand ?? '').trim(), p = String(product ?? '').trim();
  const fold = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const bw = fold(b).split(' ').filter(w => w.length > 1 && !['colonel', 'jr', 'sr', 'the'].includes(w));
  const pf = ' ' + fold(p) + ' ';
  const repeats = !!p && bw.length > 0 && bw.every(w => pf.includes(' ' + w + ' '));
  return (repeats ? p : [b, p].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
}
export const foundName = (bottle: BottleRead) =>
  displayName(bottle.match?.brand || bottle.brand, bottle.match?.product || bottle.product);

/**
 * Adds every fully recognised bottle (candidate.bottle is only set once reads
 * agree) to the strip. One chip per product, newest on the right; a product already
 * in the strip only gets its read refreshed and never moves or duplicates.
 * Returns the new list and the candidates that were added (for the fly-up).
 */
export function mergeFound(
  list: FoundItem[],
  candidates: FoundCandidate[],
  now: number,
  maximum = 40,
): { list: FoundItem[]; added: Array<{ item: FoundItem; candidate: FoundCandidate }> } {
  let next = list;
  const added: Array<{ item: FoundItem; candidate: FoundCandidate }> = [];
  for (const candidate of candidates) {
    const bottle = candidate.bottle;
    if (!bottle) continue;
    const key = identityKey(bottle);
    const name = foundName(bottle);
    if (!key || !name) continue;
    const index = next.findIndex(item => item.key === key || sameFoundProduct(item.bottle, bottle));
    if (index >= 0) {
      const existing = next[index];
      if (existing.bottle === bottle && existing.trackIds.includes(candidate.trackId)) continue;
      const changed = foundFacts(existing.bottle) !== foundFacts(bottle);
      // Keep the cleaner, shorter name once the product is known.
      const betterName = name.length < existing.name.length ? name : existing.name;
      const updated: FoundItem = {
        ...existing, bottle, name: betterName, version: existing.version + (changed ? 1 : 0),
        trackIds: existing.trackIds.includes(candidate.trackId) ? existing.trackIds : [...existing.trackIds, candidate.trackId].slice(-8),
      };
      next = next.map((item, i) => (i === index ? updated : item));
      continue;
    }
    const item: FoundItem = { key, name, bottle, trackIds: [candidate.trackId], firstSeenAt: now, version: 1 };
    next = [...next, item].slice(-maximum);
    added.push({ item, candidate });
  }
  return { list: next, added };
}
