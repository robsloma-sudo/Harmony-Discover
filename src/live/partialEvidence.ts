/**
 * Partial evidence (Rob, 17 Nov 2026): naming a bottle whose label is partly hidden (behind another bottle)
 * or cut off at the edge of the picture, from the words and part-words its label reads did see.
 *
 * The pieces from every read of one bottle are pooled. The database returns names that contain them across
 * brand AND product (US label approvals and the Harmony catalogue), so "TAYLO" + "CURED" finds
 * Colonel E.H. Taylor Cured Oak instead of plain "Taylor". This file scores those names, adds what this scan
 * session and the checked-in venue already show (the scene), and decides whether one name is clear enough to
 * show as "Probably …". A hint is never saved and never counts as evidence: only a full read, or a targeted
 * check of the leading name, confirms a bottle.
 */

export type PieceKind = 'name' | 'expression' | 'number' | 'category';
/** `full`: the descriptor a cut piece came from ("URBON" -> bourbon). */
export type Piece = { text: string; kind: PieceKind; weight: number; full?: string };

export type NameSource = 'label' | 'harmony' | 'session' | 'venue';
export type NameCandidate = { brand: string; product: string; classType?: string | null; labels: number; source: NameSource };
/** What the scene already shows: confirmed this session, seen at the checked-in venue, or on its menus. */
export type PriorName = { brand: string; product?: string | null; source: 'session' | 'venue' | 'menu' };

export type RankedName = NameCandidate & {
  score: number;
  family: string;
  /** Brand words that identify the maker (filler such as "The", "Colonel", "Distillery" dropped). */
  familyWords: string[];
  productKey: string;
  /** Distinct name pieces (not descriptors) this name explains. */
  namePieces: number;
  /** A brand word was seen (whole or cut). */
  brandSeen: boolean;
  /** A word only the product has was seen (category words do not count). */
  productSeen: boolean;
  /** Best match of any one name piece (1 = a whole word). */
  bestNameMatch: number;
  prior: number;
};

export type PartialGuess = {
  brand: string;
  /** Null when only the brand is clear. */
  product: string | null;
  level: 'brand' | 'product';
  score: number;
  lead: number;
  top: RankedName;
  /** Leading distinct names, best first, for the targeted check: products when one is clear, otherwise makers. */
  shortlist: RankedName[];
};

/** What kind of drink, or label boilerplate. Says nothing about which bottle; never a name piece. */
const CATEGORY_WORDS = new Set([
  'bourbon', 'whiskey', 'whisky', 'straight', 'kentucky', 'tennessee', 'rye', 'scotch', 'irish', 'malt', 'blended', 'blend',
  'vodka', 'gin', 'rum', 'tequila', 'mezcal', 'cognac', 'brandy', 'armagnac', 'liqueur', 'liquor', 'wine', 'beer', 'ale', 'lager',
  'cider', 'sake', 'vermouth', 'aperitivo', 'amaro', 'bitters', 'proof', 'alc', 'vol', 'abv', 'ml', 'cl', 'litre', 'liter', 'bottled',
  'bond', 'distilled', 'distillery', 'distillers', 'distilling', 'distiller', 'company', 'product', 'imported', 'import', 'the', 'and',
  'est', 'since', 'aged', 'age', 'years', 'year', 'yrs', 'old', 'label', 'only', 'first', 'made', 'by', 'of', 'in', 'from', 'usa',
  'america', 'american', 'france', 'scotland', 'ireland', 'mexico', 'canada', 'japan', 'italy', 'kingdom', 'united',
  'states', 'highland', 'speyside', 'islay', 'lowland', 'spirit', 'spirits', 'sour', 'mash', 'hand', 'handcrafted', 'crafted',
  'agave', 'destilado', 'cerveza', 'vino', 'champagne', 'hard', 'iced', 'tea', 'seltzer', 'lemonade', 'cocktail', 'cocktails',
  // Distillery towns printed on many labels.
  'clermont', 'louisville', 'frankfort', 'lawrenceburg', 'bardstown', 'lynchburg', 'loretto', 'versailles', 'owensboro', 'jalisco',
]);
/** Words that tell one expression of a brand from another, but never which brand. */
const EXPRESSION_WORDS = new Set([
  'single', 'barrel', 'barrels', 'small', 'batch', 'reserve', 'reserva', 'special', 'release', 'limited', 'edition', 'select',
  'selected', 'original', 'cask', 'strength', 'uncut', 'unfiltered', 'finish', 'finished', 'toasted', 'double', 'triple', 'private',
  'black', 'white', 'red', 'blue', 'green', 'gold', 'silver', 'extra', 'dry', 'sweet', 'spiced', 'dark', 'light', 'premium', 'finest',
  'superior', 'rare', 'oak', 'wood', 'reposado', 'anejo', 'blanco', 'plata', 'joven', 'cristalino', 'vs', 'vsop', 'xo', 'high',
  'wheat', 'wheated', 'four', 'grain', 'port', 'sherry', 'honey', 'apple', 'cherry', 'peach', 'vanilla', 'cinnamon', 'orange',
  'coffee', 'cream', 'new', 'classic', 'signature', 'family', 'estate', 'vintage', 'collection', 'series', 'no',
  // Ages and editions spelled out ("TWENTY ONE YEARS").
  'one', 'two', 'three', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'fifteen', 'eighteen', 'twenty', 'thirty',
]);
/** Two-letter words that are not initials. */
const SHORT_WORDS = new Set(['de', 'la', 'le', 'el', 'of', 'no', 'in', 'by', 'st', 'co', 'jr', 'sr', 'mr', 'ml', 'cl', 'oz', 'us', 'uk', 'an',
  'at', 'to', 'on', 'or', 'is', 'it', 'di', 'da', 'du', 'do', 'et', 'en', 'au', 'vs', 'xo', 'pf', 'ny', 'ca', 'ky', 'tn']);
/** Words that say what kind of drink it is, for checking a name against the label. */
const KIND_OF_WORD: Record<string, string> = {
  bourbon: 'bourbon', rye: 'rye', scotch: 'scotch', tennessee: 'tennessee', whiskey: 'whisky', whisky: 'whisky',
  vodka: 'vodka', gin: 'gin', rum: 'rum', tequila: 'agave', mezcal: 'agave', cognac: 'brandy', brandy: 'brandy', armagnac: 'brandy',
  liqueur: 'liqueur', wine: 'wine', beer: 'beer', ale: 'beer', lager: 'beer', cider: 'cider',
};
const WHISKIES = new Set(['bourbon', 'rye', 'scotch', 'tennessee', 'whisky']);
/** Brand words shared by unrelated makers: they never make two brands one family. */
const FAMILY_FILLER = new Set(['the', 'colonel', 'jr', 'sr', 'co', 'company', 'and', 'distillery', 'distilling', 'distillers',
  'brewing', 'brewery', 'winery', 'wines', 'cellars', 'vineyards', 'estate', 'estates', 'spirits', 'inc', 'llc', 'ltd']);

/** Lower case, accents dropped, apostrophes and dots joined (MAKER'S -> makers, E.H. -> eh), split into words. */
export function nameWords(text: string | null | undefined): string[] {
  const words = String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['\u2019`.]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  // Letters printed apart ("E. H. Taylor") read the same as "E.H. Taylor".
  const out: string[] = [];
  let letterRun = false;
  for (const word of words) {
    const single = word.length === 1 && /[a-z]/.test(word);
    if (single && letterRun) { out[out.length - 1] += word; continue; }
    out.push(word);
    letterRun = single;
  }
  return out;
}

const cutFrom = (piece: string, word: string) => word.length > piece.length && (word.startsWith(piece) || word.endsWith(piece));
const LONG_CATEGORY = [...CATEGORY_WORDS].filter(word => word.length >= 5);
const LONG_EXPRESSION = [...EXPRESSION_WORDS].filter(word => word.length >= 5);

function kindOfPiece(text: string): { kind: PieceKind; full?: string } {
  if (/^\d+$/.test(text)) return { kind: 'number' };
  if (CATEGORY_WORDS.has(text)) return { kind: 'category' };
  if (EXPRESSION_WORDS.has(text)) return { kind: 'expression' };
  // A descriptor cut at a hidden edge ("HISKEY", "PROO", "URBON") is still a descriptor, not a name.
  const category = LONG_CATEGORY.find(word => cutFrom(text, word));
  if (category) return { kind: 'category', full: category };
  const expression = LONG_EXPRESSION.find(word => cutFrom(text, word));
  if (expression) return { kind: 'expression', full: expression };
  return { kind: 'name' };
}

function weightOf(text: string, kind: PieceKind): number {
  if (kind === 'category') return 0;
  if (kind === 'number') return 0.3;
  if (kind === 'expression') return 0.35 * Math.min(1, text.length / 5);
  return Math.max(0.5, Math.min(1, text.length / 6));
}

/** Pieces worth matching from everything the reads saw: words of 3+ letters (or 2+ digits), each once. */
export function piecesFromWords(words: Array<string | null | undefined>, max = 16): Piece[] {
  const seen = new Map<string, Piece>();
  for (const word of words) {
    for (const text of nameWords(word)) {
      if (seen.has(text)) continue;
      const digits = /^\d+$/.test(text);
      if (digits ? text.length < 2 : text.length < 2) continue;
      // Two letters count only as initials ("E.H." of E.H. Taylor), and only a little.
      if (!digits && text.length === 2) {
        if (SHORT_WORDS.has(text) || !/^[a-z]{2}$/.test(text)) continue;
        seen.set(text, { text, kind: 'name', weight: 0.3 });
        continue;
      }
      const { kind, full } = kindOfPiece(text);
      seen.set(text, { text, kind, weight: weightOf(text, kind), ...(full ? { full } : {}) });
    }
  }
  // Keep the most telling pieces when a label is wordy.
  return [...seen.values()].sort((a, b) => b.weight - a.weight || b.text.length - a.text.length).slice(0, max);
}

/** Name pieces of 4+ letters, longest first: what the database looks names up by (at most 6). */
export function anchorsFor(pieces: Piece[]): string[] {
  return pieces.filter(piece => piece.kind === 'name' && piece.text.length >= 4)
    .sort((a, b) => b.text.length - a.text.length || a.text.localeCompare(b.text))
    .slice(0, 6).map(piece => piece.text);
}

// "Daniel's" / "Daniel", "Blanton's" / "Blanton": one maker.
const stem = (word: string) => word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;

function familyWordsOf(brand: string): string[] {
  let words = nameWords(brand);
  // "Jane Walker by Johnnie Walker": the maker is the part after "by".
  const by = words.lastIndexOf('by');
  if (by > 0 && by < words.length - 1) words = words.slice(by + 1);
  const kept = words.filter(word => !FAMILY_FILLER.has(word));
  return (kept.length ? kept : words).map(stem);
}

/** Brands that are one maker however the label spells them: "Colonel E.H. Taylor" = "E. H. Taylor" = "EH Taylor". */
export function familyKey(brand: string): string {
  return familyWordsOf(brand).join('');
}

/**
 * One maker: the same brand however it is spelled, or one brand name starting with the other
 * ("Tito's" / "Tito's Handmade", "Modelo" / "Modelo Especial"). "Taylor" and "Duncan Taylor" stay apart.
 */
export function sameMaker(a: Pick<RankedName, 'family' | 'familyWords'>, b: Pick<RankedName, 'family' | 'familyWords'>): boolean {
  if (a.family === b.family) return true;
  const [short, long] = a.familyWords.length <= b.familyWords.length ? [a.familyWords, b.familyWords] : [b.familyWords, a.familyWords];
  if (short.join('').length >= 4 && short.length < long.length && short.every((word, i) => long[i] === word)) return true;
  // Sub-brands of one maker share its first two words ("Jack Daniel's Country Cocktails" / "Jack Daniel's Tennessee Whiskey").
  return short.length >= 2 && short[0] === long[0] && short[1] === long[1];
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * How well one seen piece fits one word of a name (0-1). A word cut at a hidden edge keeps its start or its end
 * ("TAYLO", "URED"); a longer cut piece fits better. One misread letter is allowed in longer words.
 */
export function pieceFit(piece: string, word: string): number {
  if (piece === word) return 1;
  const p = piece.length, w = word.length;
  // MAKERS for Maker, DANIEL for Daniel's: the same word.
  if (p >= 3 && (word === piece + 's' || piece === word + 's')) return 0.97;
  if (p >= 3 && w > p && (word.startsWith(piece) || word.endsWith(piece))) return 0.5 + 0.5 * p / w;
  if (p >= 4 && w > p && word.includes(piece)) return 0.4 + 0.4 * p / w;
  if (p >= 5 && w >= 5 && Math.abs(p - w) <= 1 && editDistance(piece, word) === 1) return 0.8;
  return 0;
}

function kindOfClass(classType: string | null | undefined): string | null {
  const text = String(classType ?? '').toLowerCase();
  if (!text) return null;
  if (text.includes('bourbon')) return 'bourbon';
  if (text.includes('rye')) return 'rye';
  if (text.includes('scotch') || text.includes('malt')) return 'scotch';
  if (text.includes('tennessee')) return 'tennessee';
  if (text.includes('whisk')) return 'whisky';
  for (const kind of ['vodka', 'gin', 'rum', 'brandy', 'cognac', 'liqueur', 'cordial', 'wine', 'beer', 'ale', 'cider', 'tequila', 'mezcal', 'agave']) {
    if (text.includes(kind)) return kind === 'cognac' ? 'brandy' : kind === 'cordial' ? 'liqueur' : kind === 'ale' ? 'beer' : kind === 'tequila' || kind === 'mezcal' ? 'agave' : kind;
  }
  return null;
}

function kindsAgree(seen: string, kind: string): boolean {
  if (seen === kind) return true;
  return seen === 'whisky' ? WHISKIES.has(kind) : kind === 'whisky' && WHISKIES.has(seen);
}

export const SCENE_BOOST = Object.freeze({
  session: { family: 0.25, product: 0.1 },
  venue: { family: 0.2, product: 0.1 },
  menu: { family: 0.15, product: 0 },
});

/** How much what the scene already shows supports a name (0 when nothing matches). */
export function priorFor(candidate: { brand: string; product: string }, priors: PriorName[]): number {
  if (!priors.length) return 0;
  const family = familyKey(candidate.brand);
  const product = nameWords(candidate.product).join(' ');
  let best = 0;
  for (const prior of priors) {
    const boost = SCENE_BOOST[prior.source];
    if (prior.source === 'menu') {
      // A menu line names a drink in its own words: the brand only has to appear in it.
      const line = nameWords(prior.brand + ' ' + (prior.product ?? '')).join('');
      if (family.length >= 4 && line.includes(family)) best = Math.max(best, boost.family);
      continue;
    }
    if (familyKey(prior.brand) !== family) continue;
    const same = !!product && nameWords(prior.product).join(' ') === product;
    best = Math.max(best, boost.family + (same ? boost.product : 0));
  }
  return best;
}

/** Scene names that fit at least one seen name piece become candidates themselves (menus only boost). */
export function sceneCandidates(pieces: Piece[], priors: PriorName[]): NameCandidate[] {
  const names = pieces.filter(piece => piece.kind === 'name');
  const out: NameCandidate[] = [];
  for (const prior of priors) {
    if (prior.source === 'menu' || !prior.brand) continue;
    const words = nameWords(prior.brand + ' ' + (prior.product ?? ''));
    if (!names.some(piece => words.some(word => pieceFit(piece.text, word) >= 0.75))) continue;
    out.push({ brand: prior.brand, product: prior.product ?? '', labels: 0, source: prior.source });
  }
  return out;
}

/** Scores one name against the pieces (higher is better). */
export function scoreName(pieces: Piece[], candidate: NameCandidate, priors: PriorName[] = []): RankedName {
  const brandWords = nameWords(candidate.brand);
  const brandSet = new Set(brandWords);
  const brandLetters = brandWords.join('');
  // Product names often repeat the brand, sometimes spelled differently ("Colonel E.H.Taylor" / "Colonel E.H. Taylor ...").
  const productWords = nameWords(candidate.product).filter(word => !brandSet.has(word) && !brandLetters.includes(word));
  const words = [...brandWords.filter((word, i) => brandWords.indexOf(word) === i), ...new Set(productWords)];
  const productOnly = new Set(productWords);
  // Each piece belongs to the one word it fits best (a brand word wins a tie); each word counts its best piece once.
  const perWord = new Map<string, { value: number; fit: number; piece: Piece }>();
  const unplaced: Piece[] = [];
  for (const piece of pieces) {
    if (piece.kind === 'category') continue;
    let bestFit = 0, bestWord = '';
    for (const word of words) {
      const fit = pieceFit(piece.text, word);
      if (fit > bestFit) { bestFit = fit; bestWord = word; }
    }
    if (!bestWord) { unplaced.push(piece); continue; }
    const value = bestFit * piece.weight;
    const kept = perWord.get(bestWord);
    if (!kept || value > kept.value) perWord.set(bestWord, { value, fit: bestFit, piece });
  }
  let score = 0, brandSeen = false, bestNameMatch = 0, productPoints = 0;
  const namePiecesHit = new Set<string>();
  for (const [word, hit] of perWord) {
    score += hit.value;
    if (hit.fit < 0.75) continue;
    const initials = hit.piece.text.length === 2;
    if (hit.piece.kind === 'name' && (!initials || (hit.fit === 1 && brandSet.has(word)))) {
      namePiecesHit.add(hit.piece.text);
      if (!initials) bestNameMatch = Math.max(bestNameMatch, hit.fit);
    }
    if (brandSet.has(word) && hit.piece.kind !== 'number') brandSeen = true;
    // Product evidence: a name word, an age or edition number ("21", "46"), or two expression words ("Single Barrel");
    // one expression word alone ("Oak") fits too many products.
    if (productOnly.has(word)) productPoints += hit.piece.kind === 'name' ? 2 : hit.piece.kind === 'number' ? (hit.piece.text.length === 2 ? 2 : 1) : 1;
  }
  const productSeen = productPoints >= 2;
  // A long name piece printed across two words ("EHTAYLOR") still belongs to this name.
  for (const piece of unplaced) {
    if (piece.kind !== 'name' || piece.text.length < 5 || !words.join('').includes(piece.text)) continue;
    score += 0.85 * piece.weight;
    namePiecesHit.add(piece.text);
    bestNameMatch = Math.max(bestNameMatch, 0.85);
    if (brandLetters.includes(piece.text)) brandSeen = true;
  }
  // What kind of drink the label says it is: agreeing helps, a clear mismatch (bourbon vs scotch) hurts.
  const kind = kindOfClass(candidate.classType);
  const seenKinds = [...new Set(pieces.map(piece => KIND_OF_WORD[piece.full ?? piece.text]).filter((k): k is string => !!k))];
  if (kind && seenKinds.length) {
    if (seenKinds.some(seen => kindsAgree(seen, kind))) score += 0.15;
    else score -= 0.2;
  }
  // Well-known names are likelier; the Harmony catalogue holds what venues actually stock.
  score += 0.06 * Math.log10(1 + Math.max(0, candidate.labels));
  if (candidate.source === 'harmony') score += 0.05;
  const prior = priorFor(candidate, priors);
  score += prior;
  return {
    ...candidate, score: Math.round(score * 1000) / 1000, family: familyKey(candidate.brand), familyWords: familyWordsOf(candidate.brand),
    productKey: productWords.join(' '), namePieces: namePiecesHit.size, brandSeen, productSeen, bestNameMatch, prior,
  };
}

/** Every candidate scored and sorted, best first; the same name from two sources is kept once (the better). */
export function rankNames(pieces: Piece[], candidates: NameCandidate[], priors: PriorName[] = []): RankedName[] {
  const all = [...candidates, ...sceneCandidates(pieces, priors)].map(candidate => scoreName(pieces, candidate, priors));
  const best = new Map<string, RankedName>();
  for (const name of all) {
    const key = name.family + '|' + name.productKey;
    const kept = best.get(key);
    if (!kept || name.score > kept.score) best.set(key, kept ? { ...name, labels: Math.max(name.labels, kept.labels) } : name);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || b.labels - a.labels);
}

export const PARTIAL_RULES = Object.freeze({
  /** The leading name must explain at least this much. */
  minScore: 0.9,
  /** Lead over the best name from a different maker. */
  minLead: 0.3,
  /** Name pieces the leading name must explain (one is enough only for a known, whole-word name; see below). */
  minNamePieces: 2,
  /** One name piece is enough when it is (nearly) a whole word of 5+ letters and the maker is well known or in the scene. */
  singleMinFit: 0.85,
  singleMinLength: 5,
  singleMinLabels: 20,
  singleMinLead: 0.4,
  /** ...or this lead when the scene already shows that maker (its boost is part of the score). */
  singleMinLeadWithScene: 0.2,
  /** The scene only breaks near-ties: without it, the leading name must be within this of the best. */
  sceneTieMargin: 0.15,
  /** A whole 4-letter word ("KNOB") alone needs a maker on at least this many labels. */
  shortWordMinLabels: 50,
  /** Share of the seen name pieces the leading name must explain (the rest may be a neighbour's label). */
  minCoverage: 0.5,
  /** The product is named only when it leads the maker's other products by this much. */
  productLead: 0.15,
});

/**
 * The best name from a different maker. A label approval filed under a distributor's name ("Greek Specialty
 * Spirit" / "Metaxa Ouzo") is the same bottle when its product carries the leading brand and its own brand was not seen.
 */
export function rivalOf(top: RankedName, ranked: RankedName[]): RankedName | undefined {
  return ranked.find(name => !sameMaker(name, top)
    && !(top.family.length >= 5 && !name.brandSeen && nameWords(name.product).map(stem).join('').includes(top.family)));
}

/**
 * The name to show as "Probably …", or null when the pieces do not single one out.
 * Brand only, unless a product word was seen and that product clearly leads the maker's others.
 */
export function partialGuess(pieces: Piece[], ranked: RankedName[], rules = PARTIAL_RULES): PartialGuess | null {
  const top = ranked[0];
  if (!top || top.score < rules.minScore || !top.brandSeen && !top.productSeen) return null;
  const namePieces = pieces.filter(piece => piece.kind === 'name' && piece.text.length >= 3);
  if (!namePieces.length || Math.min(1, top.namePieces / namePieces.length) < rules.minCoverage) return null;
  // What the scene shows may tip a close call, never overturn what the words clearly say.
  if (top.prior > 0) {
    const bestWithoutScene = Math.max(...ranked.map(name => name.score - name.prior));
    if (top.score - top.prior < bestWithoutScene - rules.sceneTieMargin) return null;
  }
  const rival = rivalOf(top, ranked);
  // A rival that fits only through its product name (its own brand unseen) is weaker than a seen brand.
  const lead = rival ? top.score - rival.score * (top.brandSeen && !rival.brandSeen ? 0.85 : 1) : top.score;
  const maker = ranked.filter(name => sameMaker(name, top));
  if (top.namePieces >= rules.minNamePieces) {
    if (lead < rules.minLead) return null;
  } else {
    const makerLabels = maker.reduce((sum, name) => sum + name.labels, 0);
    const known = top.prior > 0 || makerLabels >= rules.singleMinLabels;
    // A whole short word ("KNOB") is enough only for a very well-known maker, on the words alone.
    const longEnough = namePieces.some(p => p.text.length >= rules.singleMinLength)
      || (top.bestNameMatch >= 0.97 && makerLabels >= rules.shortWordMinLabels && top.prior === 0);
    const needLead = top.prior > 0 ? rules.singleMinLeadWithScene : rules.singleMinLead;
    if (!longEnough || top.bestNameMatch < rules.singleMinFit || !known || lead < needLead) return null;
  }
  const otherProduct = maker.find(name => name.productKey !== top.productKey);
  const productClear = top.productSeen && !!top.product && (!otherProduct || top.score - otherProduct.score >= rules.productLead);
  // Brand only: the maker's main name ("Jack Daniel's", not "Jack Daniel's Country Cocktails"; the most used spelling).
  const shown = productClear ? top : maker
    .filter(name => name.familyWords.length === Math.min(...maker.map(m => m.familyWords.length)))
    .reduce((best, name) => (labelsByBrand(maker, name.brand) > labelsByBrand(maker, best.brand) ? name : best));
  // What the targeted check is asked about: products when one is clear, otherwise makers.
  const shortlist: RankedName[] = [];
  for (const name of ranked) {
    if (shortlist.length >= 3) break;
    const same = (kept: RankedName) => sameMaker(kept, name) && (!productClear || kept.productKey === name.productKey);
    if (!shortlist.some(same)) shortlist.push(name);
  }
  return {
    brand: tidyName(shown.brand), product: productClear ? productWithoutBrand(top.brand, top.product) || null : null,
    level: productClear ? 'product' : 'brand',
    score: top.score, lead: Math.round(lead * 1000) / 1000, top, shortlist,
  };
}

const labelsByBrand = (names: RankedName[], brand: string) => names.filter(name => name.brand === brand).reduce((sum, name) => sum + name.labels, 0);

// Kept in capitals when a name in capitals is tidied.
const CAPITAL_WORDS = new Set(['XO', 'VS', 'VSOP', 'IPA', 'BIB', 'USA', 'NAS', 'XXO', 'II', 'III', 'IV']);

/** Label approvals are often in capitals: "COLONEL E.H. TAYLOR" -> "Colonel E.H. Taylor". Mixed case is kept. */
export function tidyName(name: string): string {
  const text = String(name ?? '').trim();
  if (!text || /[a-z]/.test(text)) return text;
  return text.split(/(\s+)/).map(part => CAPITAL_WORDS.has(part.replace(/[^A-Z]/g, '')) ? part
    : part.toLowerCase().replace(/(^|[\-/&(])([a-z])/g, (_, gap: string, letter: string) => gap + letter.toUpperCase())
      // Initials stay capitals: "e.h." -> "E.H.".
      .replace(/(^|[^a-z])([a-z])(?=\.)/gi, (_, gap: string, letter: string) => gap + letter.toUpperCase())).join('');
}

/**
 * The product without the brand repeated at its start, as label approvals often print it:
 * ("Colonel E.H. Taylor", "Colonel E.H. Taylor Barrel Proof Rye") -> "Barrel Proof Rye".
 */
export function productWithoutBrand(brand: string, product: string): string {
  const letters = nameWords(brand).join('');
  const parts = String(product ?? '').trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < parts.length) {
    const word = nameWords(parts[i]).join('');
    if (!word || !letters.includes(word)) break;
    i++;
  }
  return tidyName(parts.slice(i).join(' ').replace(/^[,:;\-]+\s*/, ''));
}

/** "Colonel E.H. Taylor Cured Oak": the guess as one line. */
export function guessLabel(guess: Pick<PartialGuess, 'brand' | 'product'>): string {
  return guess.product ? guess.brand + ' ' + guess.product : guess.brand;
}

/** The leading names as the targeted check is asked about them (at most 3): products, or makers when only the brand is clear. */
export function checkNames(guess: Pick<PartialGuess, 'level' | 'shortlist' | 'brand'>): Array<{ brand: string; product: string }> {
  return guess.shortlist.slice(0, 3).map((name, i) => guess.level === 'product'
    ? { brand: tidyName(name.brand), product: productWithoutBrand(name.brand, name.product) }
    : { brand: i === 0 ? guess.brand : tidyName(name.brand), product: '' });
}

/** What a venue's crowd feed shows (bottles seen there, items on menus scanned there) as scene names. */
export function sceneFromVenueFeed(feed: {
  bottles?: Array<{ brand: string; product?: string | null }>;
  menus?: Array<{ items?: Array<{ name: string }> }>;
} | null | undefined): PriorName[] {
  if (!feed) return [];
  const bottles = (feed.bottles ?? []).filter(b => b.brand).slice(0, 80)
    .map(b => ({ brand: b.brand, product: b.product ?? '', source: 'venue' as const }));
  const menu = (feed.menus ?? []).flatMap(m => m.items ?? []).filter(item => item.name).slice(0, 120)
    .map(item => ({ brand: item.name, product: '', source: 'menu' as const }));
  return [...bottles, ...menu];
}
