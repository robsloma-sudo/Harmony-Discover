/**
 * Evidence that builds up per bottle while scanning.
 *
 * Every detector pass and every label read about one bottle adds to what we
 * know, instead of each new frame replacing the last one's number. The
 * "is it a bottle" certainty only grows with repeat detections. The first
 * read is shown straight away as a provisional name; it becomes the confirmed
 * name (and is saved) once reads agree on it (reliable). Facts from every
 * agreeing read are combined into one identity.
 */
export type IdentityRead = {
  brand?: string | null;
  product?: string | null;
  confidence: number;
  state?: string;
  match?: { id?: string | null; brand?: string | null; product?: string | null; score?: number } | null;
  /**
   * Read from a label that was partly hidden or cut off (17 Nov 2026): a clue, not proof. It adds to the
   * evidence, but a name is confirmed only once at least one read of it saw the label whole (or a targeted
   * check of the leading name agreed).
   */
  partial?: boolean;
};

export type TrackIdentity<T extends IdentityRead> = {
  read: T;
  /** 0..1, grows with agreeing reads, falls when reads disagree. */
  confidence: number;
  reliable: boolean;
  agreeingReads: number;
};

type Vote<T> = { read: T; weight: number; reads: number; evidence: number; best: number; fullReads: number };
/**
 * locked: the vote key once a name has been confirmed. A confirmed bottle keeps
 * its name (and its number never goes down) while it stays the same tracked
 * bottle; only a clear majority of later, different reads can replace it.
 * peak: highest confidence shown for the current leading name, so the number
 * on screen only climbs while reads agree.
 */
type Entry<T> = { detection: number; votes: Map<string, Vote<T>>; seen: Set<string>; locked?: string; peak: number; peakKey?: string };

/** One clear read at 80% or more confirms a name straight away (Rob: fly up as soon as it hits 80%). */
export const CONFIDENT_SINGLE_READ = 0.8;

/** Show a name only when agreeing reads reach this confidence and clearly beat any rival. */
export const RELIABLE_IDENTITY = 0.75;
const RELIABLE_SHARE = 0.75;

/** Lower case, accents dropped ("Mescladís" = "mescladis"), only letters and digits. */
export const foldWords = (value?: string | null) => String(value ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const clean = foldWords;

export function identityKey(read: IdentityRead): string | null {
  if (read.match?.id && (read.match.score ?? 0) >= 0.85) return 'match:' + read.match.id;
  const brand = clean(read.match?.brand || read.brand), product = clean(read.match?.product || read.product);
  return brand || product ? brand + '|' + product : null;
}

const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** Words many different bottles share; they never prove two reads name the same bottle. */
const SHARED_NAME_WORDS = new Set(['domaine', 'chateau', 'bodega', 'bodegas', 'cantina', 'tenuta', 'weingut', 'estate', 'winery', 'wines', 'wine',
  'vineyard', 'vineyards', 'cellars', 'distillery', 'brewing', 'brewery', 'rose', 'red', 'white', 'blanc', 'rouge', 'saint', 'santa', 'san',
  'bourbon', 'whiskey', 'whisky', 'straight', 'kentucky', 'vodka', 'gin', 'rum', 'tequila', 'beer', 'reserve', 'reserva', 'old']);
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
  if (shared / smaller >= 0.6 || shared / (brandA.size + brandB.size - shared) >= 0.5) return true;
  // Wine labels carry two names (estate and cuvee) and readers differ on which is the
  // brand: "Mescladís / Pic Saint Loup" and "Domaine Clavel / Mescladís" are one bottle.
  // They agree when one read's brand is wholly named somewhere in the other read.
  const nameA = tokens((a.match?.brand || a.brand || '') + ' ' + (a.match?.product || a.product || ''));
  const nameB = tokens((b.match?.brand || b.brand || '') + ' ' + (b.match?.product || b.product || ''));
  const within = (brand: Set<string>, name: Set<string>) => {
    const distinctive = [...brand].filter(word => word.length >= 3 && !SHARED_NAME_WORDS.has(word));
    return distinctive.length > 0 && distinctive.every(word => name.has(word));
  };
  return within(brandA, nameB) || within(brandB, nameA);
}

const FILL_FIELDS = ['proof', 'size', 'origin', 'category'] as const;

/** `primary` wins; empty fields, missing details and extra label words come from `other`. */
export function mergeReads<T extends IdentityRead>(primary: T, other: T): T {
  if (primary === other) return primary;
  const a = primary as unknown as Record<string, unknown>, b = other as unknown as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...a };
  for (const field of FILL_FIELDS) {
    const mine = a[field];
    if ((mine === undefined || mine === null || mine === '' || (field === 'category' && mine === 'other')) && typeof b[field] === 'string' && b[field]) merged[field] = b[field];
  }
  const da = a.details, db = b.details;
  if (db && typeof db === 'object' && !Array.isArray(db)) merged.details = { ...(db as object), ...((da && typeof da === 'object') ? da as object : {}) };
  if (Array.isArray(a.words) || Array.isArray(b.words)) {
    const words: string[] = [];
    for (const word of [...(Array.isArray(a.words) ? a.words : []), ...(Array.isArray(b.words) ? b.words : [])]) {
      const w = String(word);
      if (w && !words.some(existing => existing.toLowerCase() === w.toLowerCase())) words.push(w);
    }
    merged.words = words.slice(0, 16);
  }
  return merged as unknown as T;
}

export class TrackEvidence<T extends IdentityRead> {
  private entries = new Map<number, Entry<T>>();

  private entry(trackId: number): Entry<T> {
    let entry = this.entries.get(trackId);
    if (!entry) { entry = { detection: 0, votes: new Map(), seen: new Set(), peak: 0 }; this.entries.set(trackId, entry); }
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
    const partial = read.partial === true;
    const strength = clamp(read.confidence) * (matched ? 0.8 : 0.7) * (partial ? 0.6 : 1);
    const vote = entry.votes.get(key) ?? { read, weight: 0, reads: 0, evidence: 0, best: 0, fullReads: 0 };
    // Show the most informative read: catalogue match first, then a read with
    // an expression, then the most legible; a read of a whole label beats a partial one.
    const rank = (r: T) => (r.match?.id ? 2 : 0) + (clean(r.product) ? 1 : 0) + clamp(r.confidence) * 0.5 - (r.partial ? 1.5 : 0);
    // Each read can see a different part of the label: keep the best read and
    // fill in what it missed (proof, size, origin, details, words) from the others.
    vote.read = vote.reads === 0 ? read : rank(read) >= rank(vote.read) ? mergeReads(read, vote.read) : mergeReads(vote.read, read);
    vote.weight += clamp(read.confidence);
    vote.reads += 1;
    if (!partial) vote.fullReads += 1;
    if (read.state !== 'unsure' && !partial) vote.best = Math.max(vote.best, clamp(read.confidence));
    vote.evidence = 1 - (1 - vote.evidence) * (1 - strength);
    entry.votes.set(key, vote);
  }

  detection(trackId: number): number {
    return this.entries.get(trackId)?.detection ?? 0;
  }

  identity(trackId: number): TrackIdentity<T> | null {
    const entry = this.entries.get(trackId);
    if (!entry || !entry.votes.size) return null;
    let topKey = '', top: Vote<T> | null = null, total = 0;
    for (const [key, vote] of entry.votes) {
      total += vote.weight;
      if (!top || vote.evidence > top.evidence) { top = vote; topKey = key; }
    }
    // A confirmed name stays unless a different name clearly takes over.
    const locked = entry.locked ? entry.votes.get(entry.locked) : undefined;
    if (locked && entry.locked !== topKey) {
      const challengerShare = total > 0 ? top!.weight / total : 0;
      if (challengerShare >= 0.85 && top!.reads >= 2) { entry.locked = undefined; entry.peak = 0; }
      else { top = locked; topKey = entry.locked!; }
    }
    const share = total > 0 ? top!.weight / total : 0;
    // A clear majority (85%+) counts fully; closer contests lower the confidence.
    let confidence = top!.evidence * Math.min(1, share / 0.85);
    const strongSingle = top!.best >= CONFIDENT_SINGLE_READ && share >= RELIABLE_SHARE;
    // Clues from partly hidden labels alone never confirm a name.
    let reliable = top!.fullReads >= 1 && ((confidence >= RELIABLE_IDENTITY && share >= RELIABLE_SHARE && top!.reads >= 2) || strongSingle);
    if (strongSingle) confidence = Math.max(confidence, top!.best);
    if (entry.locked === topKey) reliable = true;
    else if (reliable) entry.locked = topKey;
    // The number shown never drops while the same name leads.
    if (entry.peakKey !== topKey) { entry.peakKey = topKey; entry.peak = 0; }
    entry.peak = Math.max(entry.peak, confidence);
    return { read: top!.read, confidence: entry.peak, reliable, agreeingReads: top!.reads };
  }

  /** Evidence follows a bottle whose track merged into another. */
  migrate(from: number, to: number): void {
    const source = this.entries.get(from);
    if (!source) return;
    const target = this.entry(to);
    target.detection = Math.max(target.detection, source.detection);
    if (!target.locked && source.locked) target.locked = source.locked;
    target.peak = Math.max(target.peak, source.peak);
    if (!target.peakKey) target.peakKey = source.peakKey;
    for (const [key, vote] of source.votes) {
      const existing = target.votes.get(key);
      if (!existing) target.votes.set(key, { ...vote });
      else {
        existing.best = Math.max(existing.best, vote.best);
        existing.weight += vote.weight;
        existing.reads += vote.reads;
        existing.fullReads += vote.fullReads;
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
