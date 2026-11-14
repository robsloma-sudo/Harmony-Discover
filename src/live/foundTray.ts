import type { BottleRead } from '../services/discoverLiveApi';
import { identityKey } from './trackEvidence';

/** One identified product in the "found" strip at the top of the scanner. */
export type FoundItem = {
  key: string;
  name: string;
  bottle: BottleRead;
  trackIds: number[];
  firstSeenAt: number;
};

export type FoundCandidate = {
  trackId: number; x: number; y: number; width: number; height: number;
  bottle?: BottleRead;
};

export const foundName = (bottle: BottleRead) =>
  [bottle.match?.brand || bottle.brand, bottle.match?.product || bottle.product].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

/**
 * Adds every fully recognised bottle (candidate.bottle is only set once reads
 * agree) to the strip. One chip per product, newest first; a product already
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
    const index = next.findIndex(item => item.key === key);
    if (index >= 0) {
      const existing = next[index];
      if (existing.bottle === bottle && existing.trackIds.includes(candidate.trackId)) continue;
      const updated: FoundItem = {
        ...existing, bottle, name,
        trackIds: existing.trackIds.includes(candidate.trackId) ? existing.trackIds : [...existing.trackIds, candidate.trackId].slice(-8),
      };
      next = next.map((item, i) => (i === index ? updated : item));
      continue;
    }
    const item: FoundItem = { key, name, bottle, trackIds: [candidate.trackId], firstSeenAt: now };
    next = [item, ...next].slice(0, maximum);
    added.push({ item, candidate });
  }
  return { list: next, added };
}
