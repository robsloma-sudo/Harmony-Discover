// P-20261125-0219 part 1 · Marty's read-only look-ups (Harmony linking).
// Reads Harmony (PHG main) by drink name or id plus the bridge token, and the guest's own saved items on Discover dev.
// Never writes anywhere: the db is only ever used as from(t).select(...) chains; PHG calls are read commands.
// Never throws: every failure becomes {status:"unavailable"}. Response bodies never appear in errors.
import { MAX_RESULT_CHARS, PHG_LOOKUP_COMMANDS } from "./lookupContract.ts";
import type { ItemKind, LookupArgs, LookupResult } from "./lookupContract.ts";

// Mutable on purpose so tests can shorten it.
export const LOOKUP_TIMEOUTS_MS = { phg: 6000 };

export interface LookupDeps {
  // deno-lint-ignore no-explicit-any
  db: { from(t: string): any };
  phg: () => Promise<{ url: string; anonKey: string; token: string }>;
  fetch?: typeof fetch;
}

type PhgCfg = { url: string; anonKey: string; token: string };
type Rec = Record<string, unknown>;

const KINDS: ItemKind[] = ["cocktail", "spirit", "wine", "beer"];
const MAX_ARG = 120;

const SAY_FOUND = "Harmony data. Answer from this; do not add facts that are not here.";
const SAY_UNSURE = "Nothing reliable in Harmony for this. Say plainly you are not sure; do not guess.";
const SAY_NO_JOURNEY = "Nothing reliable in Harmony for this. No Journey ready for this yet. Say plainly you are not sure; do not guess.";
const SAY_SAVED = "The guest's own saved items. Answer from this only; do not add anything that is not here.";
const SAY_NOTHING_SAVED = "The guest has nothing saved yet.";

const found = (data: Rec, source: "harmony" | "your_saved" = "harmony", say = SAY_FOUND): LookupResult =>
  ({ status: "found", source, data, say });
const notSure = (say = SAY_UNSURE): LookupResult => ({ status: "not_sure", source: null, data: null, say });
const unavailable = (): LookupResult => ({ status: "unavailable", source: null, data: null, say: SAY_UNSURE });

const isObj = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);

// ---------- argument parsing ----------
function cleanText(x: unknown): string | null {
  if (typeof x !== "string") return null;
  // deno-lint-ignore no-control-regex
  const t = x.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_ARG).trim();
  return t || null;
}

function cleanKind(x: unknown): ItemKind | null {
  if (typeof x !== "string") return null;
  const k = x.trim().toLowerCase();
  return (KINDS as string[]).includes(k) ? k as ItemKind : null;
}

export function parseLookupArgs(tool: unknown, args: unknown): LookupArgs | null {
  if (typeof tool !== "string") return null;
  let o: unknown = args;
  if (typeof o === "string") {
    if (!o.trim()) o = {};
    else { try { o = JSON.parse(o); } catch { return null; } }
  }
  if (o == null) o = {};
  if (!isObj(o)) return null;
  switch (tool) {
    case "lookup_cocktail": {
      const name = cleanText(o.name);
      return name ? { tool, name } : null;
    }
    case "lookup_bottle": {
      const name = cleanText(o.name);
      return name ? { tool, name, brand: cleanText(o.brand) } : null;
    }
    case "lookup_brand": {
      const brand = cleanText(o.brand);
      return brand ? { tool, brand } : null;
    }
    case "lookup_journey":
    case "pairing_ideas": {
      const name = cleanText(o.name);
      if (!name) return null;
      const kind = o.kind == null || o.kind === "" ? "cocktail" : cleanKind(o.kind);
      return kind ? { tool, name, kind } : null;
    }
    case "my_saved_drinks":
      return { tool };
    default:
      return null;
  }
}

// ---------- PHG config + transport ----------
export async function loadPhgConfig(db: { from(t: string): any }): Promise<PhgCfg> { // deno-lint-ignore no-explicit-any
  let rows: Array<{ key: string; value: string }> | null = null;
  try {
    const r = await db.from("discover_bridge_config").select("key,value").in("key", ["phg_url", "phg_anon_key", "phg_bridge_token"]);
    rows = r?.data ?? null;
  } catch { throw new Error("phg_unavailable"); }
  const m: Record<string, string> = Object.fromEntries((rows ?? []).map((x) => [x.key, x.value]));
  if (!m.phg_url || !m.phg_anon_key || !m.phg_bridge_token) throw new Error("phg_unavailable");
  return { url: String(m.phg_url).replace(/\/+$/, ""), anonKey: m.phg_anon_key, token: m.phg_bridge_token };
}

// Exactly the params each read command may carry (besides p_token). Nothing about the guest ever leaves.
const ALLOWED_PARAMS: Record<string, string[]> = {
  [PHG_LOOKUP_COMMANDS.cocktailFind]: ["p_name", "p_limit"],
  [PHG_LOOKUP_COMMANDS.recipe]: ["p_cocktail_id"],
  [PHG_LOOKUP_COMMANDS.journey]: ["p_item_kind", "p_item_ref", "p_build"],
  [PHG_LOOKUP_COMMANDS.pairing]: ["p_item_kind", "p_item_ref", "p_name"],
};
const PERSON_KEY_RE = /subject|user|consumer|observation|person|guest|email/i;

async function rpc(cfg: PhgCfg, f: typeof fetch, fn: string, args: Rec): Promise<unknown> {
  // Privacy guard first, before any network call.
  const allowed = ALLOWED_PARAMS[fn];
  if (!allowed) throw new Error("phg_unavailable");
  for (const k of Object.keys(args)) if (!allowed.includes(k) || PERSON_KEY_RE.test(k)) throw new Error("lookup_privacy");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LOOKUP_TIMEOUTS_MS.phg);
  try {
    const r = await f(cfg.url.replace(/\/+$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { apikey: cfg.anonKey, authorization: "Bearer " + cfg.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ p_token: cfg.token, ...args }),
      signal: ac.signal,
    });
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* */ } throw new Error("phg_unavailable"); }
    return await r.json();
  } catch (e) {
    if (e instanceof Error && (e.message === "phg_unavailable" || e.message === "lookup_privacy")) throw e;
    if (ac.signal.aborted || (e as Error)?.name === "AbortError" || (e as Error)?.name === "TimeoutError") throw new Error("phg_timeout");
    throw new Error("phg_unavailable");
  } finally { clearTimeout(timer); }
}

// ---------- shared recipe-reply parser (fallbacks passed in) ----------
interface ParsedRecipe {
  name: string; ingredients: Array<{ ingredient: string; amount: string | null }>;
  method: string | null; glass: string | null; garnish: string | null; est_abv: number | null;
}
function parseRecipeReply(r: unknown, fallbacks: { name: string }): ParsedRecipe {
  const rec = isObj(r) && isObj(r.recipe) ? r.recipe : null;
  if (!rec || !Array.isArray(rec.lines)) throw new Error("phg_unavailable");
  const ingredients = rec.lines.filter(isObj).slice(0, 30)
    .map((l) => ({ ingredient: String(str(l.ingredient) ?? "").slice(0, 120), amount: str(l.amount) }))
    .filter((l) => l.ingredient);
  const abv = Number(rec.est_abv);
  return {
    name: String(str(rec.name) ?? fallbacks.name).slice(0, 120), ingredients,
    method: str(rec.method), glass: str(rec.glass), garnish: str(rec.garnish),
    est_abv: rec.est_abv != null && Number.isFinite(abv) && abv >= 0 && abv <= 100 ? abv : null,
  };
}

// ---------- Discover dev (select only) ----------
const likeEsc = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

async function sel(db: LookupDeps["db"], table: string, cols: string, build: (q: any) => any): Promise<Rec[]> { // deno-lint-ignore no-explicit-any
  const r = await build(db.from(table).select(cols));
  if (!r || r.error) throw new Error("db_unavailable");
  return Array.isArray(r.data) ? r.data.filter(isObj) : [];
}

const PRODUCT_COLS = "phg_product_id,phg_brand_id,brand,name,category,abv,size_ml,origin,country,producer,status";
const PROFILE_COLS = "phg_brand_id,brand,ten_second,thirty_second,history,producer,production,style,pronunciation";

function pickByName(rows: Rec[], name: string): Rec | null {
  if (!rows.length) return null;
  const n = name.toLowerCase();
  const exact = rows.find((r) => String(r.name ?? "").trim().toLowerCase() === n);
  if (exact) return exact;
  return [...rows].sort((a, b) => String(a.name ?? "").length - String(b.name ?? "").length)[0];
}

async function findProducts(db: LookupDeps["db"], name: string, brand: string | null): Promise<Rec[]> {
  return await sel(db, "discover_phg_products", PRODUCT_COLS, (q) => {
    let x = q.ilike("name", `%${likeEsc(name)}%`);
    if (brand) x = x.ilike("brand", `%${likeEsc(brand)}%`);
    return x.limit(5);
  });
}

const strList = (x: unknown, n: number): string[] =>
  (Array.isArray(x) ? x : []).map((s) => str(s)).filter((s): s is string => !!s).slice(0, n);

function abvPercent(x: unknown): number | null {
  const n = typeof x === "number" ? x : parseFloat(String(x ?? ""));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

// ---------- cocktail resolution ----------
interface FoundCocktail { id: string; name: string; others: string[] }
// null = no match. Throws when the command is missing/failing (caller maps to unavailable).
async function findCocktail(cfg: PhgCfg, f: typeof fetch, name: string): Promise<FoundCocktail | null> {
  const reply = await rpc(cfg, f, PHG_LOOKUP_COMMANDS.cocktailFind, { p_name: name, p_limit: 3 });
  if (!Array.isArray(reply)) throw new Error("phg_unavailable");
  const items = reply.filter(isObj).filter((x) => str(x.id) && str(x.name));
  if (!items.length) return null;
  const pick = items.find((x) => x.match === "exact") ?? items.find((x) => x.match === "close") ?? items[0];
  return {
    id: String(pick.id), name: String(pick.name).slice(0, 120),
    others: items.filter((x) => x !== pick).map((x) => String(x.name).slice(0, 120)).slice(0, 2),
  };
}

// ---------- the tools ----------
async function lookupCocktail(cfg: PhgCfg, f: typeof fetch, name: string): Promise<LookupResult> {
  const c = await findCocktail(cfg, f, name);
  if (!c) return notSure();
  const r = parseRecipeReply(await rpc(cfg, f, PHG_LOOKUP_COMMANDS.recipe, { p_cocktail_id: c.id }), { name: c.name });
  return found({
    name: r.name, ingredients: r.ingredients, method: r.method, glass: r.glass, garnish: r.garnish,
    est_abv: r.est_abv, also_known_close: c.others,
  });
}

async function lookupBottle(db: LookupDeps["db"], name: string, brand: string | null): Promise<LookupResult> {
  const rows = await findProducts(db, name, brand);
  const p = pickByName(rows, name);
  if (!p) return notSure();
  let profile: Rec | null = null;
  const bid = str(p.phg_brand_id);
  if (bid) {
    try {
      profile = (await sel(db, "discover_phg_brand_profiles", PROFILE_COLS, (q) => q.eq("phg_brand_id", bid).limit(1)))[0] ?? null;
    } catch { profile = null; } // the product facts still stand without the story
  }
  return found({
    brand: str(p.brand), name: str(p.name), category: str(p.category), abv_percent: abvPercent(p.abv),
    size_ml: str(p.size_ml), country: str(p.country), producer: str(p.producer) ?? str(profile?.producer),
    story: str(profile?.ten_second), history: strList(profile?.history, 3), style: strList(profile?.style, 3),
    pronunciation: str(profile?.pronunciation), other_sizes_or_versions: Math.max(0, rows.length - 1),
  });
}

async function lookupBrand(db: LookupDeps["db"], brand: string): Promise<LookupResult> {
  const rows = await sel(db, "discover_phg_brand_profiles", PROFILE_COLS, (q) => q.ilike("brand", `%${likeEsc(brand)}%`).limit(3));
  if (!rows.length) return notSure();
  const b = brand.toLowerCase();
  const p = rows.find((r) => String(r.brand ?? "").trim().toLowerCase() === b) ?? rows[0];
  let productCount: number | null = null;
  const bid = str(p.phg_brand_id);
  if (bid) {
    try {
      const r = await db.from("discover_phg_products").select("phg_product_id", { count: "exact", head: true }).eq("phg_brand_id", bid);
      productCount = r && !r.error && typeof r.count === "number" ? r.count : null;
    } catch { productCount = null; }
  }
  return found({
    brand: str(p.brand), story: str(p.ten_second), more: str(p.thirty_second), history: strList(p.history, 5),
    producer: str(p.producer), production: str(p.production), style: strList(p.style, 5),
    pronunciation: str(p.pronunciation), product_count: productCount,
  });
}

interface Ref { ref: string | null; name: string }
// Resolves a name to an item ref. Throws only on transport/db failure.
async function resolveRef(deps: LookupDeps, getCfg: () => Promise<PhgCfg>, f: typeof fetch, name: string, kind: ItemKind): Promise<Ref | null> {
  if (kind === "cocktail") {
    const c = await findCocktail(await getCfg(), f, name);
    return c ? { ref: c.id, name: c.name } : null;
  }
  const p = pickByName(await findProducts(deps.db, name, null), name);
  const id = str(p?.phg_product_id);
  return p && id ? { ref: id, name: String(str(p.name) ?? name).slice(0, 120) } : null;
}

async function lookupJourney(deps: LookupDeps, getCfg: () => Promise<PhgCfg>, f: typeof fetch, name: string, kind: ItemKind): Promise<LookupResult> {
  const r = await resolveRef(deps, getCfg, f, name, kind);
  if (!r || !r.ref) return notSure(SAY_NO_JOURNEY);
  // p_build is ALWAYS false: fetch never queues and never writes.
  const reply = await rpc(await getCfg(), f, PHG_LOOKUP_COMMANDS.journey, { p_item_kind: kind, p_item_ref: r.ref, p_build: false });
  if (!isObj(reply)) throw new Error("phg_unavailable");
  const journey = isObj(reply.journey) ? reply.journey : null;
  if (reply.status !== "ready" || !journey) return notSure(SAY_NO_JOURNEY);
  // PHG's compact Journey (discover_journey_fetch_or_build, ready) lists its stops as `nodes`; `stops` kept as a fallback.
  const rawStops = Array.isArray(journey.nodes) ? journey.nodes : Array.isArray(journey.stops) ? journey.stops : [];
  const stops = rawStops.filter(isObj).slice(0, 6).map((s) => {
    const claims = (Array.isArray(s.claims) ? s.claims : []).map((c) => isObj(c) ? str(c.text) : str(c)).filter((t): t is string => !!t);
    return { title: str(s.title) ?? str(s.name), notes: claims.slice(0, 2) };
  }).filter((s) => s.title);
  if (!stops.length) return notSure(SAY_NO_JOURNEY);
  const secs = Number(journey.duration_s);
  return found({ name: r.name, minutes: Number.isFinite(secs) && secs > 0 ? Math.round(secs / 60) : null, stops });
}

async function pairingIdeas(deps: LookupDeps, getCfg: () => Promise<PhgCfg>, f: typeof fetch, name: string, kind: ItemKind): Promise<LookupResult> {
  let ref: Ref = { ref: null, name };
  try {
    const r = await resolveRef(deps, getCfg, f, name, kind);
    if (r) ref = r;
  } catch { /* resolution failing still lets the name go through */ }
  const reply = await rpc(await getCfg(), f, PHG_LOOKUP_COMMANDS.pairing, { p_item_kind: kind, p_item_ref: ref.ref, p_name: ref.name });
  if (!isObj(reply) || !Array.isArray(reply.ideas)) throw new Error("phg_unavailable");
  const ideas = reply.ideas.filter(isObj).map((i) => ({ pairing: str(i.pairing), why: str(i.why) }))
    .filter((i): i is { pairing: string; why: string | null } => !!i.pairing).slice(0, 5);
  return ideas.length ? found({ name: ref.name, ideas }) : notSure();
}

async function mySavedDrinks(db: LookupDeps["db"], subjectId: string): Promise<LookupResult> {
  // subjectId is only ever used in .eq filters on Discover dev.
  const versions = await sel(db, "discover_explore_versions", "name,base_cocktail_id,change_types,created_at",
    (q) => q.eq("subject_id", subjectId).order("created_at", { ascending: false }).limit(10));
  const sightings = await sel(db, "bottle_sightings", "read_brand,read_product,discover_product_id,seen_at",
    (q) => q.eq("consumer_id", subjectId).not("discover_product_id", "is", null).order("seen_at", { ascending: false }).limit(10));
  const vs = versions.map((v) => ({ name: str(v.name), changes: strList(v.change_types, 10) })).filter((v) => v.name);
  const seen = new Set<string>();
  const bottles: Array<{ brand: string | null; product: string | null }> = [];
  for (const s of sightings) {
    const brand = str(s.read_brand), product = str(s.read_product);
    if (!brand && !product) continue;
    const k = `${brand ?? ""}|${product ?? ""}`.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    bottles.push({ brand, product });
  }
  if (!vs.length && !bottles.length) return notSure(SAY_NOTHING_SAVED);
  return found({
    versions: vs, bottles,
    note: "Favourites are not stored on the server yet; only saved versions and recognised bottles are listed.",
  }, "your_saved", SAY_SAVED);
}

// ---------- size cap ----------
function shrink(v: unknown, strMax: number, arrMax: number): unknown {
  if (typeof v === "string") return v.length > strMax ? v.slice(0, strMax) : v;
  if (Array.isArray(v)) return v.slice(0, arrMax).map((x) => shrink(x, strMax, arrMax));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shrink(x, strMax, arrMax)]));
  return v;
}
function fit(res: LookupResult): LookupResult {
  if (JSON.stringify(res).length <= MAX_RESULT_CHARS) return res;
  for (const [s, a] of [[600, 20], [400, 10], [250, 6], [160, 4], [100, 3], [60, 2], [40, 1]]) {
    const t = { ...res, data: shrink(res.data, s, a) as Rec | null };
    if (JSON.stringify(t).length <= MAX_RESULT_CHARS) return t;
  }
  return unavailable();
}

// ---------- entry point ----------
export async function runLookup(deps: LookupDeps, subjectId: string, a: LookupArgs): Promise<LookupResult> {
  try {
    const f = deps.fetch ?? fetch;
    let cached: Promise<PhgCfg> | null = null;
    const getCfg = () => (cached ??= deps.phg());
    let res: LookupResult;
    switch (a.tool) {
      case "lookup_cocktail": res = await lookupCocktail(await getCfg(), f, a.name); break;
      case "lookup_bottle": res = await lookupBottle(deps.db, a.name, a.brand); break;
      case "lookup_brand": res = await lookupBrand(deps.db, a.brand); break;
      case "lookup_journey": res = await lookupJourney(deps, getCfg, f, a.name, a.kind); break;
      case "pairing_ideas": res = await pairingIdeas(deps, getCfg, f, a.name, a.kind); break;
      case "my_saved_drinks":
        if (typeof subjectId !== "string" || !subjectId) return unavailable();
        res = await mySavedDrinks(deps.db, subjectId);
        break;
      default: return unavailable();
    }
    return fit(res);
  } catch {
    return unavailable(); // never include the error text: it could carry response details
  }
}
