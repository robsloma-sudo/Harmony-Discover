/**
 * Evidence that builds up per bottle while scanning.
 *
 * Every detector pass and every label read about one bottle adds to what we
 * know, instead of each new frame replacing the last one's number. The
 * "is it a bottle" certainty only grows with repeat detections. A name is
 * shown only once reads agree on it (reliable); until then the bottle shows
 * how far identification has got.
 */
export type IdentityRead = {
  brand?: string | null;
  product?: string | null;
  confidence: number;
  state?: string;
  match?: { id?: string | null; brand?: string | null; product?: string | null; score?: number } | null;
};

export type TrackIdentity<T extends IdentityRead> = {
  read: T;
  /** 0..1, grows with agreeing reads, falls when reads disagree. */
  confidence: number;
  reliable: boolean;
  agreeingReads: number;
};

type Vote<T> = { read: T; weight: number; reads: number; evidence: number };
type Entry<T> = { detection: number; votes: Map<string, Vote<T>>; seen: Set<string> };

/** Show a name only when agreeing reads reach this confidence and clearly beat any rival. */
export const RELIABLE_IDENTITY = 0.75;
const RELIABLE_SHARE = 0.75;

const clean = (value?: string | null) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function identityKey(read: IdentityRead): string | null {
  if (read.match?.id && (read.match.score ?? 0) >= 0.85) return 'match:' + read.match.id;
  const brand = clean(read.match?.brand || read.brand), product = clean(read.match?.product || read.product);
  return brand || product ? brand + '|' + product : null;
}

const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const tokens = (value?: string | null) => new Set(clean(value).split(' ').filter(word => word.length > 1 && !['the', 'and', 'jr', 'sr', 'co', 'company'].includes(word)));

/** Two reads name the same bottle: same catalogue product, or brands that clearly agree. */
export function sameBottleIdentity(a: IdentityRead, b: IdentityRead): boolean {
  if (a.match?.id && b.match?.id) return a.match.id === b.match.id;
  const brandA = tokens(a.match?.brand || a.brand), brandB = tokens(b.match?.brand || b.brand);
  if (!brandA.size || !brandB.size) {
    // No brand on one side: agree only on the same expression words.
    const productA = clean(a.match?.product || a.product), productB = clean(b.match?.product || b.product);
    return !!productA && productA === productB;
  }
  let shared = 0;
  brandA.forEach(word => { if (brandB.has(word)) shared++; });
  const smaller = Math.min(brandA.size, brandB.size);
  return shared / smaller >= 0.6 || shared / (brandA.size + brandB.size - shared) >= 0.5;
}

export class TrackEvidence<T extends IdentityRead> {
  private entries = new Map<number, Entry<T>>();

  private entry(trackId: number): Entry<T> {
    let entry = this.entries.get(trackId);
    if (!entry) { entry = { detection: 0, votes: new Map(), seen: new Set() }; this.entries.set(trackId, entry); }
    return entry;
  }

  /** A detector pass that saw this bottle. Certainty never goes down. */
  observeDetection(trackId: number, confidence: number): number {
    const entry = this.entry(trackId);
    const c = clamp(confidence);
    // Never below the best single pass, and each further pass adds a little.
    entry.detection = Math.max(entry.detection, c, entry.detection === 0 ? c : 1 - (1 - entry.detection) * (1 - 0.35 * c));
    return entry.detection;
  }

  /** A label/cloud read of this bottle. `sourceKey` makes repeats of one read count once. */
  observeIdentity(trackId: number, read: T, sourceKey: string): void {
    const own = identityKey(read);
    if (!own) return;
    const entry = this.entry(trackId);
    if (entry.seen.has(sourceKey)) return;
    entry.seen.add(sourceKey);
    if (entry.seen.size > 64) entry.seen = new Set([...entry.seen].slice(-32));
    // One physical bottle: reads that name the same brand agree, even when OCR
    // words the expression slightly differently ("Small Batch" / "Small Batch
    // Bourbon") or reads the brand a little differently ("E.H. Taylor" /
    // "Colonel E.H. Taylor, Jr.").
    const key = [...entry.votes.keys()].find(existing => sameBottleIdentity(entry.votes.get(existing)!.read, read)) ?? own;
    const matched = read.state === 'matched' && (read.match?.score ?? 0) >= 0.9;
    const strength = clamp(read.confidence) * (matched ? 0.8 : 0.7);
    const vote = entry.votes.get(key) ?? { read, weight: 0, reads: 0, evidence: 0 };
    // Show the most informative read: catalogue match first, then a read with
    // an expression, then the most legible.
    const rank = (r: T) => (r.match?.id ? 2 : 0) + (clean(r.product) ? 1 : 0) + clamp(r.confidence) * 0.5;
    if (vote.reads === 0 || rank(read) >= rank(vote.read)) vote.read = read;
    vote.weight += clamp(read.confidence);
    vote.reads += 1;
    vote.evidence = 1 - (1 - vote.evidence) * (1 - strength);
    entry.votes.set(key, vote);
  }

  detection(trackId: number): number {
    return this.entries.get(trackId)?.detection ?? 0;
  }

  identity(trackId: number): TrackIdentity<T> | null {
    const entry = this.entries.get(trackId);
    if (!entry || !entry.votes.size) return null;
    let top: Vote<T> | null = null, total = 0;
    for (const vote of entry.votes.values()) {
      total += vote.weight;
      if (!top || vote.evidence > top.evidence) top = vote;
    }
    const share = total > 0 ? top!.weight / total : 0;
    // A clear majority (85%+) counts fully; closer contests lower the confidence.
    const confidence = top!.evidence * Math.min(1, share / 0.85);
    return {
      read: top!.read,
      confidence,
      reliable: confidence >= RELIABLE_IDENTITY && share >= RELIABLE_SHARE && top!.reads >= 2,
      agreeingReads: top!.reads,
    };
  }

  /** Evidence follows a bottle whose track merged into another. */
  migrate(from: number, to: number): void {
    const source = this.entries.get(from);
    if (!source) return;
    const target = this.entry(to);
    target.detection = Math.max(target.detection, source.detection);
    for (const [key, vote] of source.votes) {
      const existing = target.votes.get(key);
      if (!existing) target.votes.set(key, { ...vote });
      else {
        existing.weight += vote.weight;
        existing.reads += vote.reads;
        existing.evidence = 1 - (1 - existing.evidence) * (1 - vote.evidence);
      }
    }
    source.seen.forEach(key => target.seen.add(key));
    this.entries.delete(from);
  }

  delete(trackId: number): void {
    this.entries.delete(trackId);
  }

  clear(): void {
    this.entries.clear();
  }
}
