export type WebBottleTrackState = {
  hits: number;
  misses: number;
  confidence: number;
};

type BottleIdentity = {
  brand?: string | null;
  product?: string | null;
  match?: { brand?: string | null; product?: string | null } | null;
};

const identityKey = (bottle: BottleIdentity): string =>
  [bottle.match?.brand || bottle.brand, bottle.match?.product || bottle.product]
    .map(value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');

/** A geometry track is visible after repeat confirmation, or one strong read. */
export function isConfirmedWebBottleTrack(track: WebBottleTrackState): boolean {
  return Number.isFinite(track.hits)
    && track.hits >= 2
    && track.misses >= 0
    && track.misses <= 1
    && Number.isFinite(track.confidence)
    && track.confidence >= 0.45;
}

/** True only when both observations carry complete, contradictory product identities. */
export function hasBottleIdentityConflict(previous: BottleIdentity, next: BottleIdentity): boolean {
  const previousKey = identityKey(previous);
  const nextKey = identityKey(next);
  return !!previousKey && !!nextKey && previousKey !== nextKey;
}
