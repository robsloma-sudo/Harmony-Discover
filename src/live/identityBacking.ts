// What the label really shows (Rob, 17 Nov 2026). A read of only "KNOB CREEK" had been matched by the catalogue
// to "Knob Creek Single Barrel Reserve", and a Knob Creek 21 Year was shown as a 9 Year. A name is only treated
// as known as far as the words actually read off the label back it up:
//   - a catalogue match keeps its expression only when the label's words show it (and every number in it);
//   - a bottle is "fully identified" only with a backed expression and a backed catalogue match, read twice;
//     anything less asks the person scanning to pick the right bottle.
import { foldWords } from './trackEvidence';

// Words that say what kind of drink it is, not which one (same list the server's guess check uses).
const GENERIC = new Set(['the', 'de', 'del', 'della', 'di', 'du', 'des', 'la', 'le', 'les', 'el', 'los', 'and', 'of', 'co', 'company',
  'domaine', 'chateau', 'bodega', 'bodegas', 'cantina', 'weingut', 'estate', 'estates', 'winery', 'wines', 'wine', 'vineyard', 'vineyards',
  'cellars', 'cellar', 'distillery', 'distilling', 'distillers', 'brewing', 'brewery', 'colonel', 'jr', 'sr', 'rose', 'red', 'white', 'blanc',
  'rouge', 'tinto', 'bianco', 'rosso', 'sparkling', 'bourbon', 'whiskey', 'whisky', 'straight', 'kentucky', 'vodka', 'gin', 'rum', 'tequila',
  'mezcal', 'liqueur', 'beer', 'ale', 'lager', 'cider']);

/** Half the distinctive words of `value` were read, and every number in it was read too. */
export function shownByWords(value: string | null | undefined, words: Array<string | null | undefined>): boolean {
  const tokens = foldWords(value).split(' ').filter(t => (t.length >= 3 || /\d/.test(t)) && !GENERIC.has(t));
  if (!tokens.length) return true;
  const said = foldWords(words.filter(Boolean).join(' '));
  const spaced = ' ' + said + ' ', squashed = said.replace(/ /g, '');
  const hits = tokens.filter(t => spaced.includes(' ' + t + ' ') || squashed.includes(t)).length;
  if (hits < Math.max(1, Math.ceil(tokens.length * 0.5))) return false;
  return tokens.filter(t => /^\d+$/.test(t)).every(n => spaced.includes(' ' + n + ' '));
}

type Matchable = {
  brand?: string | null;
  product?: string | null;
  words?: string[] | null;
  match?: { id?: string | null; brand?: string | null; product?: string | null; score?: number } | null;
  state?: string;
};

/** Drops a catalogue match whose expression the label's words do not show (a brand-only read gains no expression). */
export function keepBackedMatch<T extends Matchable>(read: T): T {
  const match = read.match;
  if (!match?.product) return read;
  if (shownByWords(match.product, [read.product ?? '', ...(read.words ?? [])])) return read;
  return { ...read, match: null, state: read.state === 'matched' ? 'reported' : read.state };
}

/** The expression the read gives is shown by the label's words. */
export function expressionShown(read: Matchable): boolean {
  const product = read.match?.product || read.product;
  return !!foldWords(product) && shownByWords(product, [read.product ?? '', ...(read.words ?? [])]);
}
