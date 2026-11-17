/**
 * "Probably …": a fast, cautious brand guess from the biggest words the phone
 * reads on a label (Rob, 17 Nov 2026).
 *
 * The phone's text reader returns a few large words (often with a misread or a
 * clipped first letter). The server's letter catalogue (184,868 US label brands,
 * matched by the letters in each word) turns them into ranked brands. This file
 * decides when the top brand is safe to show as a hint. A hint is never saved,
 * never counts as evidence, and the cloud label read always replaces it.
 *
 * Gate, tuned on 80 real bottle photos (17 Nov 2026): wrong guesses came from
 * descriptor words (SINGLE BARREL, GOLD LABEL, ORIGINAL RUM) and from rare
 * brands with only a label or two; right guesses were common brands with an
 * exact word match and a clear lead over the runner-up.
 */

export type LetterMatch = { brand: string; score: number; matched_words: number; exact_hits: number; labels: number };
/** `edge`: the word runs into the bottle's edge or the crop's side, so letters may be missing. */
export type OcrWord = { text: string; confidence: number; height: number; edge?: boolean };

/** Words printed on many labels that say what the drink is, not who made it. */
const DESCRIPTORS = new Set([
  'vodka', 'gin', 'rum', 'tequila', 'mezcal', 'whisky', 'whiskey', 'bourbon', 'scotch', 'rye', 'brandy', 'cognac', 'armagnac',
  'liqueur', 'liquor', 'cream', 'wine', 'beer', 'ale', 'lager', 'cider', 'sake', 'vermouth', 'aperitivo', 'amaro', 'bitters',
  'single', 'barrel', 'malt', 'blended', 'blend', 'small', 'batch', 'straight', 'kentucky', 'tennessee', 'london', 'dry',
  'original', 'originale', 'gold', 'silver', 'black', 'white', 'red', 'blue', 'green', 'label', 'reserve', 'reserva', 'select',
  'selected', 'special', 'premium', 'finest', 'old', 'aged', 'year', 'years', 'yrs', 'proof', 'vol', 'alc', 'abv', 'ml', 'cl',
  'litre', 'liter', 'imported', 'import', 'distilled', 'distillery', 'distillers', 'distilling', 'company', 'co', 'est', 'since',
  'product', 'of', 'the', 'and', 'by', 'bottled', 'bottle', 'craft', 'pure', 'superior', 'extra', 'anejo', 'reposado',
  'blanco', 'plata', 'spiced', 'dark', 'light', 'coffee', 'orange', 'cherry', 'vanilla', 'honey', 'apple', 'flavored', 'flavoured',
  'france', 'scotland', 'ireland', 'irish', 'mexico', 'usa', 'america', 'american', 'italy', 'canada', 'canadian', 'japan',
  'sweden', 'swedish', 'russia', 'russian', 'jamaica', 'cuba', 'kingdom', 'united', 'states', 'highland', 'speyside', 'islay',
]);

const plain = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const lettersOf = (text: string) => plain(text).replace(/[^a-z]/g, '');
// Apostrophes join (TITO'S -> titos, MAKER'S -> makers); anything else splits words.
const tokens = (text: string) => plain(text).replace(/['\u2019`]/g, '').split(/[^a-z]+/).filter(Boolean);

/**
 * Drops descriptor words and scraps under 4 letters ("& CO'S" once matched a brand called "Cos");
 * keeps the brand-like part of each read.
 */
export function brandWords(words: string[]): string[] {
  const kept: string[] = [];
  for (const word of words) {
    const remaining = tokens(word).filter(token => !DESCRIPTORS.has(token) && token.length >= 2);
    const joined = remaining.join(' ');
    if (lettersOf(joined).length >= 4) kept.push(joined);
  }
  return kept;
}

/** True when a brand name is nothing but descriptor words ("Single Barrel", "Original Rum"). */
export function isDescriptorBrand(brand: string): boolean {
  const parts = tokens(brand);
  return !parts.length || parts.every(part => DESCRIPTORS.has(part));
}

const firstToken = (brand: string) => tokens(brand)[0] ?? '';

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
 * How well the letters, in order, match the brand (0-1). The catalogue matches letters in any order, so
 * TITOS also finds the anagram "Tosti"; spelling order breaks such ties.
 */
export function orderedSimilarity(words: string[], brand: string): number {
  const parts = tokens(brand);
  const targets = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    let joined = '';
    for (let j = i; j < parts.length; j++) { joined += parts[j]; targets.add(joined); }
  }
  let best = 0;
  for (const word of words) {
    const a = lettersOf(word);
    if (!a) continue;
    for (const b of targets) best = Math.max(best, 1 - editDistance(a, b) / Math.max(a.length, b.length));
  }
  return best;
}

const ORDER_WEIGHT = 0.6;

export const GUESS_RULES = Object.freeze({
  minScore: 0.95,
  minLabels: 5,
  minLead: 0.15,
  /** Without an exact word: only very common brands, with a clear lead. */
  inexactMinLabels: 50,
  inexactMinLead: 0.2,
});

/**
 * The brand to show as "Probably …", or null when the evidence is not strong enough.
 * `words` are the words that were looked up (for the spelling-order tie-break).
 */
export function probableBrand(matches: LetterMatch[], words: string[] = [], rules = GUESS_RULES): string | null {
  const ranked = matches
    .filter(match => !isDescriptorBrand(match.brand))
    .map(match => ({ ...match, adjusted: match.score + ORDER_WEIGHT * (words.length ? orderedSimilarity(words, match.brand) : 0) }))
    .sort((a, b) => b.adjusted - a.adjusted);
  const top = ranked[0];
  if (!top || !(top.score >= rules.minScore) || !(top.labels >= rules.minLabels)) return null;
  const second = ranked[1];
  const lead = second ? top.adjusted - second.adjusted : Infinity;
  const sameFamily = !!second && firstToken(second.brand) === firstToken(top.brand);
  if (top.exact_hits >= 1) return lead >= rules.minLead || sameFamily ? top.brand : null;
  return top.labels >= rules.inexactMinLabels && (lead >= rules.inexactMinLead || sameFamily) ? top.brand : null;
}

/** Same brand family? Used to record whether a guess matched the cloud read. */
export function sameBrand(a: string, b: string): boolean {
  const x = lettersOf(a), y = lettersOf(b);
  if (!x || !y) return false;
  if (x === y || x.startsWith(y) || y.startsWith(x)) return true;
  const fa = firstToken(a), fb = firstToken(b);
  return fa.length >= 4 && fa === fb;
}

/** The biggest words first; at most `count`. */
export function biggestWords(words: OcrWord[], count = 4): string[] {
  return words.slice().sort((a, b) => b.height - a.height).slice(0, count).map(word => word.text);
}

/** One answer from the part-word search (brand letters that contain what the phone could read). */
export type FragmentMatch = { brand: string; score: number; labels: number; fragments_matched: number; coverage: number };

export const FRAGMENT_RULES = Object.freeze({
  minScore: 0.85,
  minCoverage: 0.6,
  /** Part-words fit many names, so only well-known brands may be guessed from them. */
  minLabels: 20,
  minLead: 0.2,
  /** Any other name on at least this many labels that fits nearly as well blocks the guess (CAMPAR: Campari or Camparo). */
  minRivalLabels: 5,
  /** A rare brand that fits the letters much better still blocks the guess. */
  rareBlockMargin: 0.4,
});

/**
 * Round bottles hide or squeeze the letters at their edges, so the phone often reads only part of a word
 * ("AMESON", "URKEY"). The part-word search returns brands whose letters contain those pieces; this picks
 * one only when a well-known brand clearly fits best. Otherwise no guess (the cloud read still names it).
 */
export function probableFromFragments(matches: FragmentMatch[], rules = FRAGMENT_RULES): string | null {
  const usable = matches.filter(match => !isDescriptorBrand(match.brand));
  const credible = usable.filter(match => match.labels >= rules.minLabels);
  const top = credible[0];
  if (!top || !(top.score >= rules.minScore) || !(top.coverage >= rules.minCoverage)) return null;
  const rival = usable.find(match => match !== top && match.labels >= rules.minRivalLabels && firstToken(match.brand) !== firstToken(top.brand));
  if (rival && top.score - rival.score < rules.minLead) return null;
  const rare = usable.find(match => match.labels < rules.minLabels && firstToken(match.brand) !== firstToken(top.brand));
  if (rare && rare.score - top.score >= rules.rareBlockMargin) return null;
  return top.brand;
}

/** Pieces worth a part-word search: brand-like reads of 4+ letters (after descriptor words are dropped). */
export function fragmentWords(words: string[]): string[] {
  const pieces = new Set<string>();
  for (const word of brandWords(words)) {
    const parts = word.split(/\s+/);
    if (parts.length > 1) pieces.add(parts.join(''));
    for (const part of parts) if (part.length >= 4) pieces.add(part);
  }
  return [...pieces].filter(piece => piece.length >= 4).slice(0, 6);
}

/**
 * Whole-word guess vs part-word guess. A cut word can spell a different, shorter brand
 * (JAMES of JAMESON, BACAR of BACARDI spells "Barac"), so when the words run into the bottle's edge, or
 * the part-word brand is far better known, the part-word guess wins. Otherwise the whole-word guess.
 */
export function chooseGuess(
  whole: { brand: string; labels: number } | null,
  part: { brand: string; labels: number } | null,
  wordsCutAtEdge: boolean,
): string | null {
  if (whole && part) {
    if (sameBrand(whole.brand, part.brand)) return whole.brand;
    return wordsCutAtEdge || part.labels >= 3 * whole.labels ? part.brand : whole.brand;
  }
  if (part) return part.brand;
  if (!whole) return null;
  // A cut word that happens to spell a lesser-known brand is not trusted on its own.
  return wordsCutAtEdge && whole.labels < 50 ? null : whole.brand;
}
