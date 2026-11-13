export type VerifiedBottleIdentity = {
  catalogId: string;
  brand: string;
  product: string;
  confidence: number;
  matchScore: number;
  verifiedAt: number;
};

export type BottleIdentityEvidence = {
  catalogId?: string | null;
  brand?: string | null;
  product?: string | null;
  confidence: number;
  matchScore?: number | null;
  matched: boolean;
};

export type IdentityLockResult =
  | { locked: true; identity: VerifiedBottleIdentity; replaced: boolean }
  | { locked: false; reason: 'insufficient_evidence' | 'identity_conflict' | 'invalid_identity' };

/**
 * Session-scoped identity cache keyed by physical bottle ID.
 * A product identity is locked only from an explicit catalog match with
 * sufficiently strong model confidence and match score. Weak later reads
 * cannot erase or silently replace a previously verified identity.
 */
export class PhysicalBottleIdentityRegistry {
  private readonly identities = new Map<string, VerifiedBottleIdentity>();

  constructor(
    private readonly minimumConfidence = 0.85,
    private readonly minimumMatchScore = 0.9,
  ) {}

  lock(physicalObjectId: string, evidence: BottleIdentityEvidence, now: number): IdentityLockResult {
    const catalogId = String(evidence.catalogId ?? '').trim();
    const brand = String(evidence.brand ?? '').trim();
    const product = String(evidence.product ?? '').trim();
    if (!physicalObjectId.trim() || !catalogId || !brand || !product || !Number.isFinite(now)) {
      return { locked: false, reason: 'invalid_identity' };
    }
    if (!evidence.matched || evidence.confidence < this.minimumConfidence
      || (evidence.matchScore ?? 0) < this.minimumMatchScore) {
      return { locked: false, reason: 'insufficient_evidence' };
    }

    const previous = this.identities.get(physicalObjectId);
    if (previous && previous.catalogId !== catalogId) {
      return { locked: false, reason: 'identity_conflict' };
    }
    const identity: VerifiedBottleIdentity = previous
      ? { ...previous, confidence: Math.max(previous.confidence, evidence.confidence),
          matchScore: Math.max(previous.matchScore, evidence.matchScore ?? 0) }
      : { catalogId, brand, product, confidence: evidence.confidence,
          matchScore: evidence.matchScore ?? 0, verifiedAt: now };
    this.identities.set(physicalObjectId, identity);
    return { locked: true, identity: { ...identity }, replaced: false };
  }

  get(physicalObjectId: string): VerifiedBottleIdentity | null {
    const identity = this.identities.get(physicalObjectId);
    return identity ? { ...identity } : null;
  }

  forget(physicalObjectId: string): boolean {
    return this.identities.delete(physicalObjectId);
  }

  clear(): void {
    this.identities.clear();
  }

  get size(): number {
    return this.identities.size;
  }
}
