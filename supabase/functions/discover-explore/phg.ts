// P-20261123-0711 part 3 · calls from Discover to PHG main (Harmony). Draft command names live in contract.ts.
// Pull-style, token-guarded RPCs like discover-catalog-sync. Never sends consumer_id / observation_id.
// Errors thrown are only "phg_timeout" or "phg_unavailable" (or "phg_config" -> phg_unavailable); never response bodies.
import { PHG_COMMANDS } from "./contract.ts";
import type {
  ChangeType, ChangedCocktail, CocktailChange, CountRow, ItemKind, JourneyResult, LinkedItem, LinkedLine,
  MenuLineIn, PhgConfig, Recipe,
} from "./contract.ts";

// Mutable on purpose so tests can shorten them.
export const TIMEOUTS_MS = { link: 20_000, change: 30_000, journeyFetch: 8_000, journeyBuild: 45_000, counts: 30_000 };
const MAX_LINES = 200, BATCH = 50;
const KINDS: ItemKind[] = ["cocktail", "spirit", "wine", "beer", "other"];
const ROLES = ["base", "modifier", "garnish", "pour", "other"];
const CHANGES: ChangeType[] = ["swap_base", "smokier", "lower_proof", "stronger", "sweeter", "drier", "more_citrus", "less_ice", "no_alcohol", "other"];
const COUNT_KEYS = ["venue_id", "week_start", "item_kind", "item_ref", "event", "change_type", "count", "guests"];
const COUNT_EVENTS = ["tap", "journey_open", "change", "save_my_version"];

// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any };

export async function loadPhgConfig(db: Db): Promise<PhgConfig> {
  let rows: Array<{ key: string; value: string }> | null = null;
  try {
    const r = await db.from("discover_bridge_config").select("key,value");
    rows = r?.data ?? null;
  } catch { throw new Error("phg_unavailable"); }
  const m: Record<string, string> = Object.fromEntries((rows ?? []).map((x) => [x.key, x.value]));
  if (!m.phg_url || !m.phg_anon_key || !m.phg_bridge_token) throw new Error("phg_unavailable");
  return { url: String(m.phg_url).replace(/\/+$/, ""), anonKey: m.phg_anon_key, token: m.phg_bridge_token };
}

// ---------- menu lines ----------
const DRINK_RE = /\b(cocktails?|mocktails?|wines?|beers?|ales?|lagers?|ipa|stout|spirits?|liquors?|liqueurs?|whisk(?:e)?y|bourbon|scotch|vodka|gin|rum|tequila|mezcal|brandy|cognac|sake|cider|seltzer|champagne|sparkling|prosecco|by the glass|btg|draft|on tap|bottles?|non[- ]?alcoholic|zero[- ]proof|spritz|negroni|margarita|martini|old fashioned|highball|digestifs?|aperitifs?|amaro|vermouth|sherry|port)\b/i;
const FOOD_RE = /\b(food|appetizers?|starters?|entrees?|mains?|sides?|desserts?|salads?|soups?|sandwich(?:es)?|burgers?|pizzas?|pastas?|brunch|breakfast|kids|snacks?|small plates?|raw bar)\b/i;

const clip = (s: unknown, n: number): string | null => {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, n) : null;
};

function isDrink(r: Record<string, unknown>): boolean {
  const cat = typeof r.beverage_category === "string" ? r.beverage_category.trim() : "";
  if (cat) return !FOOD_RE.test(cat) || DRINK_RE.test(cat);
  const section = String(r.section ?? ""), name = String(r.name ?? "");
  if (DRINK_RE.test(section)) return true;
  if (FOOD_RE.test(section)) return false;
  return DRINK_RE.test(name);
}

export function menuLinesFromItems(rows: Array<Record<string, unknown>>): MenuLineIn[] {
  const out: MenuLineIn[] = [];
  for (const r of rows ?? []) {
    if (out.length >= MAX_LINES) break;
    if (!r || typeof r.id !== "string") continue;
    const name = clip(r.name, 120);
    if (!name || !isDrink(r)) continue;
    const ing = Array.isArray(r.listed_ingredients)
      ? (r.listed_ingredients as unknown[]).map((x) => clip(x, 80)).filter((x): x is string => !!x).slice(0, 20) : [];
    // Only these fields are copied: consumer_id / observation_id can never leave.
    out.push({
      line_id: r.id, section: clip(r.section, 80), name, description: clip(r.description, 400),
      price_text: clip(r.price_text, 30), beverage_category: clip(r.beverage_category, 60), listed_ingredients: ing,
    });
  }
  return out;
}

// ---------- transport ----------
async function rpc(cfg: PhgConfig, fn: string, args: Record<string, unknown>, ms: number): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(cfg.url.replace(/\/+$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { apikey: cfg.anonKey, authorization: "Bearer " + cfg.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ p_token: cfg.token, ...args }),
      signal: ac.signal,
    });
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* */ } throw new Error("phg_unavailable"); }
    return await r.json();
  } catch (e) {
    if (e instanceof Error && e.message === "phg_unavailable") throw e;
    if (ac.signal.aborted || (e as Error)?.name === "AbortError" || (e as Error)?.name === "TimeoutError") throw new Error("phg_timeout");
    throw new Error("phg_unavailable");
  } finally { clearTimeout(timer); }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);
const kindOf = (x: unknown): ItemKind | null => (KINDS as string[]).includes(x as string) ? x as ItemKind : null;

function guessKind(line: MenuLineIn): ItemKind {
  const t = `${line.beverage_category ?? ""} ${line.section ?? ""}`.toLowerCase();
  if (/cocktail|mocktail|spritz/.test(t)) return "cocktail";
  if (/wine|champagne|sparkling|prosecco|by the glass|btg/.test(t)) return "wine";
  if (/beer|ale|lager|ipa|stout|draft|cider|seltzer/.test(t)) return "beer";
  if (/spirit|whisk|bourbon|scotch|vodka|gin|rum|tequila|mezcal|brandy|cognac|liquor|liqueur/.test(t)) return "spirit";
  return "other";
}
const notLinked = (line: MenuLineIn): LinkedLine =>
  ({ line_id: line.line_id, status: "not_linked", kind: guessKind(line), cocktail: null, items: [], confidence: 0 });

function normLine(raw: unknown, line: MenuLineIn): LinkedLine {
  try {
    if (!isObj(raw)) return notLinked(line);
    const kind = kindOf(raw.kind) ?? guessKind(line);
    const items: LinkedItem[] = [];
    for (const it of Array.isArray(raw.items) ? raw.items.slice(0, 20) : []) {
      if (!isObj(it)) continue;
      const name = str(it.name); if (!name) continue;
      items.push({
        kind: kindOf(it.kind) ?? "other", phg_product_id: str(it.phg_product_id), name: name.slice(0, 120),
        role: ROLES.includes(it.role as string) ? it.role as LinkedItem["role"] : "other",
      });
    }
    let cocktail: LinkedLine["cocktail"] = null;
    if (isObj(raw.cocktail) && str(raw.cocktail.id)) cocktail = { id: String(raw.cocktail.id), name: String(str(raw.cocktail.name) ?? line.name).slice(0, 120) };
    if (raw.status !== "linked" || (!cocktail && !items.length)) return { ...notLinked(line), kind };
    const c = Number(raw.confidence);
    return { line_id: line.line_id, status: "linked", kind, cocktail, items, confidence: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0 };
  } catch { return notLinked(line); }
}

export async function phgLinkLines(cfg: PhgConfig, lines: MenuLineIn[], venue?: { name: string | null }): Promise<LinkedLine[]> {
  const out: LinkedLine[] = [];
  const list = lines.slice(0, MAX_LINES);
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    const reply = await rpc(cfg, PHG_COMMANDS.linkLines,
      { p_lines: batch, p_venue_name: clip(venue?.name, 120) }, TIMEOUTS_MS.link);
    const arr = Array.isArray(reply) ? reply : isObj(reply) && Array.isArray(reply.lines) ? reply.lines : [];
    const byId = new Map<string, unknown>();
    for (const r of arr) if (isObj(r) && typeof r.line_id === "string") byId.set(r.line_id, r);
    for (const l of batch) out.push(byId.has(l.line_id) ? normLine(byId.get(l.line_id), l) : notLinked(l));
  }
  return out;
}

export async function phgChangeCocktail(
  cfg: PhgConfig, a: { cocktail_id: string | null; recipe: Recipe | null; changes: CocktailChange[] },
): Promise<ChangedCocktail> {
  const r = await rpc(cfg, PHG_COMMANDS.changeCocktail,
    { p_cocktail_id: a.cocktail_id, p_recipe: a.recipe, p_changes: a.changes }, TIMEOUTS_MS.change);
  const o = isObj(r) ? r : null;
  const rec = o && isObj(o.recipe) ? o.recipe : null;
  if (!o || !rec || !str(rec.name) || !Array.isArray(rec.lines) || !str(o.bartender_card) || !str(o.home_recipe)) throw new Error("phg_unavailable");
  const lines = rec.lines.filter(isObj).slice(0, 30).map((l) => ({
    ingredient: String(str(l.ingredient) ?? "").slice(0, 120), amount: str(l.amount), phg_product_id: str(l.phg_product_id),
  })).filter((l) => l.ingredient);
  const abv = Number(rec.est_abv);
  const types = (Array.isArray(o.change_types) ? o.change_types : []).filter((t): t is ChangeType => (CHANGES as string[]).includes(t as string));
  return {
    recipe: {
      name: String(rec.name).slice(0, 120), base_cocktail_id: str(rec.base_cocktail_id) ?? a.recipe?.base_cocktail_id ?? a.cocktail_id ?? null, lines,
      method: str(rec.method), glass: str(rec.glass), garnish: str(rec.garnish),
      est_abv: rec.est_abv != null && Number.isFinite(abv) && abv >= 0 && abv <= 100 ? abv : null,
    },
    bartender_card: String(o.bartender_card).slice(0, 2000), home_recipe: String(o.home_recipe).slice(0, 4000),
    change_types: types.length ? types : a.changes.map((c) => c.type),
    ai_used: typeof o.ai_used === "boolean" ? o.ai_used : true,
  };
}

export async function phgJourney(
  cfg: PhgConfig, a: { item_kind: ItemKind; item_ref: string; build: boolean },
): Promise<JourneyResult> {
  const r = await rpc(cfg, PHG_COMMANDS.journey, { p_item_kind: a.item_kind, p_item_ref: a.item_ref, p_build: a.build },
    a.build ? TIMEOUTS_MS.journeyBuild : TIMEOUTS_MS.journeyFetch);
  if (!isObj(r)) throw new Error("phg_unavailable");
  const status = (["ready", "built", "building", "none"] as const).find((s) => s === r.status) ?? "none";
  const journey = isObj(r.journey) ? r.journey : null;
  return { status: journey || status === "building" ? status : "none", built_now: r.built_now === true && status === "built", journey };
}

export async function phgSendCounts(cfg: PhgConfig, rows: CountRow[]): Promise<{ accepted: number }> {
  // Privacy guard: only the exact CountRow keys may leave; checked before any network call.
  for (const r of rows) {
    if (!isObj(r)) throw new Error("counts_contain_ids");
    for (const k of Object.keys(r)) if (!COUNT_KEYS.includes(k)) throw new Error("counts_contain_ids");
    if (!COUNT_EVENTS.includes(r.event) || !Number.isFinite(r.count) || !Number.isFinite(r.guests)) throw new Error("counts_contain_ids");
  }
  if (!rows.length) return { accepted: 0 };
  const reply = await rpc(cfg, PHG_COMMANDS.counts, { p_rows: rows }, TIMEOUTS_MS.counts);
  const n = isObj(reply) ? Number(reply.accepted) : Number(reply);
  return { accepted: Number.isFinite(n) ? Math.max(0, Math.min(rows.length, Math.floor(n))) : 0 };
}
