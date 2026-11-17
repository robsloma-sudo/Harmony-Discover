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

/**
 * True when two observations of one physical track name different products.
 * - Different brands always conflict, even when a product is not yet read.
 * - The same brand conflicts only when both products are present and differ.
 * - A read with no brand never conflicts (it adds no identity evidence).
 */
export function hasBottleIdentityConflict(previous: BottleIdentity, next: BottleIdentity): boolean {
  const previousIdentity = normalizedIdentity(previous);
  const nextIdentity = normalizedIdentity(next);
  if (!previousIdentity.brand || !nextIdentity.brand) return false;
  if (previousIdentity.brand !== nextIdentity.brand) return true;
  return !!previousIdentity.product && !!nextIdentity.product && previousIdentity.product !== nextIdentity.product;
}

export type MergeableBottleRead = BottleIdentity & {
  category?: string; proof?: string; size?: string; origin?: string;
  words?: string[]; confidence: number;
  fieldConfidence?: Record<string, number>;
  details?: Record<string, string | string[]>;
  state?: string;
};

/**
 * Fold a new label read into a track's current identity without creating a
 * composite record. A conflicting read replaces every identity field (no
 * brand from one bottle with the product, size or details of another); a
 * compatible read fills gaps; a brand-less read never changes identity.
 */
export function mergeBottleRead<T extends MergeableBottleRead>(previous: T, read: MergeableBottleRead): T {
  const readBrand = String(read.brand ?? '').trim();
  if (hasBottleIdentityConflict(previous, read)) {
    return {
      ...previous,
      brand: read.brand ?? '', product: read.product ?? '', category: read.category ?? previous.category,
      proof: read.proof ?? '', size: read.size ?? '', origin: read.origin ?? '',
      words: read.words ?? [], confidence: read.confidence,
      fieldConfidence: { ...(read.fieldConfidence ?? {}) }, details: { ...(read.details ?? {}) },
      match: read.state === 'matched' ? (read.match ?? null) : null,
      state: read.state ?? previous.state,
    };
  }
  if (!readBrand) {
    // Brand-less text may still carry facts, but only where the track has none.
    return {
      ...previous,
      proof: previous.proof || read.proof || '', size: previous.size || read.size || '',
      origin: previous.origin || read.origin || '',
      details: { ...(read.details ?? {}), ...(previous.details ?? {}) },
    };
  }
  return {
    ...previous,
    brand: read.brand || previous.brand, product: read.product || previous.product,
    category: read.category || previous.category, proof: read.proof || previous.proof,
    size: read.size || previous.size, origin: read.origin || previous.origin,
    words: read.words?.length ? read.words : previous.words,
    confidence: Math.max(previous.confidence, read.confidence),
    fieldConfidence: { ...(previous.fieldConfidence ?? {}), ...(read.fieldConfidence ?? {}) },
    details: { ...(previous.details ?? {}), ...(read.details ?? {}) },
    match: read.match || previous.match || null,
    state: read.state === 'matched' || previous.state === 'matched' ? 'matched' : (read.state ?? previous.state),
  };
}
