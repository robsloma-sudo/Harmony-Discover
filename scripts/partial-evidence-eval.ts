// Partial-evidence evaluation (Deno). Real label texts from Discover scans, with occlusion simulated (words dropped,
// words cut at an edge), run against the live discover_partial_lookup and the app's scoring and "Probably …" rules.
// Prints how many hidden labels get a name and how many of those names are wrong. Read-only against Discover DEV
// (it signs in as a new anonymous scanner user, like a visitor opening the site).
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... deno run --allow-net --allow-env scripts/partial-evidence-eval.ts [--scene]
import { anchorsFor, familyKey, partialGuess, piecesFromWords, rankNames, type NameCandidate, type PriorName } from '../src/live/partialEvidence.ts';

const base = Deno.env.get('EXPO_PUBLIC_SUPABASE_URL') ?? '';
const key = Deno.env.get('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ?? '';
if (!base || !key) throw new Error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
const session = await (await fetch(base + '/auth/v1/signup', { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: '{"data":{}}' })).json();
const cache = new Map<string, NameCandidate[]>();
async function lookup(anchors: string[]): Promise<NameCandidate[]> {
  const k = anchors.join(',');
  if (!cache.has(k)) {
    const rows = await (await fetch(base + '/rest/v1/rpc/discover_partial_lookup', { method: 'POST', headers: { apikey: key, authorization: 'Bearer ' + session.access_token, 'content-type': 'application/json' }, body: JSON.stringify({ p_anchors: anchors, p_limit: 150 }) })).json() as Array<Record<string, unknown>>;
    cache.set(k, rows.map(row => ({ brand: String(row.brand ?? ''), product: String(row.product ?? ''), classType: String(row.class_type ?? ''), labels: Number(row.labels) || 0, source: row.source === 'harmony' ? 'harmony' : 'label' })));
  }
  return cache.get(k)!;
}

// [maker, label text] from Discover sightings (16-17 Nov 2026).
const LABELS: Array<[string, string]> = [
  ['Colonel E.H. Taylor', 'THE LABEL COLONEL E.H. TAYLOR, JR. 1ST AND ONLY CURED OAK COLONEL E.H. TAYLOR CURED OAK BOTTLED IN BOND'],
  ['Colonel E.H. Taylor', 'COLONEL E.H. TAYLOR JR. TAYLOR BARREL PROOF WHISKEY & UNFILTERED 1ST AND ONLY BOTTLED IN BOND'],
  ['Colonel E.H. Taylor', 'Colonel E.H. Taylor Small Batch Kentucky Straight Bourbon'],
  ['Knob Creek', 'KNOB CREEK Kentucky Straight Bourbon Whiskey 21 Aged Twenty One Years Small Batch 100 PROOF Limited Edition Clermont, Kentucky'],
  ['Michter\'s', 'MICHTER\'S LIMITED RELEASE BARREL STRENGTH KENTUCKY STRAIGHT RYE WHISKEY 1753'],
  ['Jack Daniel\'s', 'Jack Daniel\'s Single Barrel Special Release Tennessee Whiskey'],
  ['Jameson', 'JAMESON TRIPLE DISTILLED IRISH WHISKEY'],
  ['Blanton\'s', 'Blanton\'s Original Single Barrel Bourbon Whiskey Barrel No. Rack No. Bottled by hand at 93 proof'],
  ['Buffalo Trace', 'BUFFALO TRACE Kentucky Straight Bourbon'],
  ['Bombay Sapphire', 'Bombay Sapphire London Dry Gin'],
  ['Casamigos', 'Casamigos Blanco Tequila 100% Agave'],
  ['Crown Royal', 'Crown Royal Regal APPLE'],
  ['Four Roses', 'Four Roses Small Batch'],
  ['Hennessy', 'Hennessy VERY SPECIAL COGNAC'],
  ['Johnnie Walker', 'Johnnie Walker Black Label'],
  ['Maker\'s Mark', 'Maker\'s Mark 46'],
  ['Smirnoff', 'SMIRNOFF No. 21 VODKA'],
  ['The Macallan', 'The Macallan 12 Years'],
  ['Tito\'s', 'Tito\'s Handmade Vodka'],
  ['Wild Turkey', 'WILD TURKEY 101 KENTUCKY STRAIGHT BOURBON WHISKEY'],
];
let seed = 17;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const cut = (w: string, keep: number, left: boolean) => { const l = w.replace(/[^A-Za-z0-9]/g, ''); if (l.length < 4) return l; const n = Math.max(3, Math.ceil(l.length * keep)); return left ? l.slice(l.length - n) : l.slice(0, n); };
const sameMakerName = (a: string, b: string) => { const x = familyKey(a), y = familyKey(b); return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))); };
let total = 0, shown = 0, wrong = 0;
for (const [maker, text] of LABELS) {
  const words = text.split(/\s+/);
  const variants: string[][] = [];
  for (const k of [1, 2, 3]) if (words.length >= k) variants.push([...words.slice(0, k - 1), cut(words[k - 1]!, 0.6 + 0.2 * rnd(), false)]);
  for (let r = 0; r < 3; r++) variants.push(words.filter(() => rnd() < 0.55).map(w => w.length >= 5 && rnd() < 0.35 ? cut(w, 0.6 + 0.25 * rnd(), rnd() < 0.5) : w));
  for (const seen of variants) {
    total++;
    const pieces = piecesFromWords(seen);
    const anchors = anchorsFor(pieces);
    if (!anchors.length) continue;
    const priors: PriorName[] = Deno.args.includes('--scene') ? [{ brand: maker, product: 'Another Expression', source: 'session' }] : [];
    const guess = partialGuess(pieces, rankNames(pieces, await lookup(anchors), priors));
    if (!guess) continue;
    shown++;
    if (!sameMakerName(guess.brand, maker)) { wrong++; console.log(`WRONG ${maker} <- [${seen.join(' ')}] => ${guess.brand}`); }
  }
}
console.log(`hidden labels ${total}, named ${shown} (${(100 * shown / total).toFixed(0)}%), wrong names ${wrong} (${(100 * wrong / Math.max(1, shown)).toFixed(1)}% of named)`);
