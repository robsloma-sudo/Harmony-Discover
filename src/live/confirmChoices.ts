// "Which one is it?" (Rob, 17 Nov 2026): when the scanner knows the maker but not for certain which bottle, it asks
// the person scanning instead of guessing. The choices are that maker's bottles from the label catalogue and
// Harmony's products, best fit to the words actually read first (numbers count: "21" picks the 21 Year).
import { familyKey, familyWordsOf, piecesFromWords, productWithoutBrand, rankNames, sameMaker, tidyName, type NameCandidate, type PriorName } from './partialEvidence';
import { foldWords } from './trackEvidence';

export type ConfirmChoice = { brand: string; product: string };

/** Up to `max` choices for one bottle: the maker's best-fitting bottles, plus what the reader itself said. */
export function confirmChoices(
  read: { brand?: string | null; product?: string | null; words?: string[] | null },
  candidates: NameCandidate[],
  priors: PriorName[] = [],
  max = 5,
): ConfirmChoice[] {
  const brand = String(read.brand ?? '').trim();
  if (!brand) return [];
  // Only what was seen on the label (and the brand) decides the order; the reader's own expression is not evidence.
  const pieces = piecesFromWords([brand, ...(read.words ?? [])]);
  const maker = { family: familyKey(brand), familyWords: familyWordsOf(brand) };
  const out: ConfirmChoice[] = [];
  const seen = new Set<string>();
  const add = (choice: ConfirmChoice) => {
    const key = foldWords(choice.brand) + '|' + foldWords(choice.product);
    if (seen.has(key) || !choice.brand) return;
    seen.add(key);
    out.push(choice);
  };
  for (const name of rankNames(pieces, candidates, priors)) {
    if (!sameMaker(maker, name)) continue;
    add({ brand: tidyName(name.brand), product: productWithoutBrand(name.brand, name.product) });
    if (out.length >= max - 1) break;
  }
  const own = { brand: tidyName(brand), product: tidyName(String(read.product ?? '').trim()) };
  // The reader's own name goes second when it is not already a choice (first when there are no others).
  if (!seen.has(foldWords(own.brand) + '|' + foldWords(own.product))) {
    out.splice(Math.min(1, out.length), 0, own);
    seen.add(foldWords(own.brand) + '|' + foldWords(own.product));
  }
  return out.slice(0, max);
}
