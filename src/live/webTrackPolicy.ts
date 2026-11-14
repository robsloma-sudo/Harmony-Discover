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

const normalizedIdentity = (bottle: BottleIdentity): { brand: string; product: string } => ({
  brand: String(bottle.match?.brand || bottle.brand || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  product: String(bottle.match?.product || bottle.product || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
});

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
  const previousIdentity = normalizedIdentity(previous);
  const nextIdentity = normalizedIdentity(next);
  // A brand-only or product-only read is not enough evidence to overwrite
  // an established identity. Compare only complete brand + product pairs.
  if (!previousIdentity.brand || !previousIdentity.product || !nextIdentity.brand || !nextIdentity.product) {
    return false;
  }
  return previousIdentity.brand !== nextIdentity.brand
    || previousIdentity.product !== nextIdentity.product;
}
