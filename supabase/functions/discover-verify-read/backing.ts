// Harmony Discover DEV — discover-verify-read: the check that the words a model says it can see really back
// the name it chose. Kept apart from the function so it can be tested without a server.

export const fold = (v: unknown) => String(v ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/['\u2019`.]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// Words that say what kind of drink it is; they never tell two candidates apart.
const KIND_WORDS = new Set(["the", "de", "del", "la", "le", "les", "el", "and", "of", "bourbon", "whiskey", "whisky", "straight",
  "kentucky", "tennessee", "rye", "scotch", "vodka", "gin", "rum", "tequila", "mezcal", "cognac", "brandy", "liqueur", "wine",
  "wines", "beer", "ale", "lager", "cider", "proof", "bottled", "bond", "old", "aged", "years", "year"]);
// Words in many makers' names.
const MAKER_FILLER = new Set(["co", "company", "colonel", "jr", "sr", "distillery", "distilling", "distillers", "brewing", "brewery",
  "winery", "estate", "spirits"]);
const words = (v: unknown) => fold(v).split(" ").filter(Boolean);

/** The visible words show this name word: whole, or cut at a hidden edge (4+ letters kept). */
function seen(word: string, visible: string[], squashed: string): boolean {
  if (visible.includes(word)) return true;
  if (word.length >= 4 && squashed.includes(word)) return true;
  return visible.some((v) => v.length >= 4 && v.length < word.length && (word.startsWith(v) || word.endsWith(v)));
}

export type Candidate = { brand: string; product: string };

/**
 * Which part of the chosen name the visible words back: its product, only its brand, or nothing.
 * Only words that tell the chosen name apart from the other candidates count: "Taylor" does not back
 * Colonel E.H. Taylor when Duncan Taylor is also a candidate, and "Oak" does not pick Cured Oak over Toasted Oak.
 */
export function backing(chosen: Candidate, others: Candidate[], visibleWords: string[]): "product" | "brand" | "none" {
  const visible = visibleWords.flatMap(words);
  const squashed = visible.join("");
  const makerKey = (c: Candidate) => words(c.brand).filter((w) => !KIND_WORDS.has(w) && !MAKER_FILLER.has(w)).join(" ");
  const brandWords = words(chosen.brand).filter((w) => !KIND_WORDS.has(w) && !MAKER_FILLER.has(w));
  const otherMakers = new Set(others.filter((o) => makerKey(o) !== makerKey(chosen)).flatMap((o) => words(o.brand)));
  const brandSeen = brandWords.some((w) => !otherMakers.has(w) && seen(w, visible, squashed));
  const brandSet = new Set(words(chosen.brand));
  const productWords = words(chosen.product).filter((w) => !brandSet.has(w) && !KIND_WORDS.has(w));
  const otherWords = new Set(others.flatMap((o) => [...words(o.brand), ...words(o.product)]));
  const productSeen = productWords.some((w) => w.length >= 3 && !otherWords.has(w) && seen(w, visible, squashed));
  if (productSeen) return "product";
  return brandSeen ? "brand" : "none";
}

/**
 * Visible words that belong to another candidate (not to the chosen one) make the choice ambiguous. Words from
 * anything else in the crop, such as the label of the bottle standing in front, do not count.
 */
export function pointsToAnother(chosen: Candidate, others: Candidate[], contradicting: string[]): boolean {
  const own = new Set([...words(chosen.brand), ...words(chosen.product)]);
  const seenWords = contradicting.flatMap(words).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !KIND_WORDS.has(w) && !own.has(w));
  if (!seenWords.length) return false;
  const squashed = seenWords.join("");
  return others.some((o) => [...words(o.brand), ...words(o.product)]
    .some((w) => w.length >= 3 && !own.has(w) && !KIND_WORDS.has(w) && !MAKER_FILLER.has(w) && seen(w, seenWords, squashed)));
}
