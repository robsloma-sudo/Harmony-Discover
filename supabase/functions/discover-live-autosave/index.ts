// Harmony Discover DEV: discover-live-autosave v0.6.1
// Saves bottles the live scanner is SURE of (reads agreed on the name) as sightings, for people
// who switched on Live Recognition (its consent text says sightings are saved).
// v0.3.0: every bottle is first resolved to brand + line + release + size (discover_resolve_bottle):
// category words are never used as the product name, the barcode picks the line, proof + laser lot
// code pick the release. Resolved bottles link to one Discover product per identity; the reply
// carries the identity and a shape key (brand|line|size) that liquid-level calibration uses.
// Unresolved bottles use the previous attach path unchanged.
// v0.6.1 (fix kit FIX-003): a fact is kept only when the answer itself cites a real search-result URL for it and gives
// it a score. Facts are no longer attached to the first two search pages when uncited, and a missing score is no longer
// treated as 0.75 (it is dropped as "no_score").
// v0.6.0: known facts first. Every saved bottle and every opened card is linked to Harmony's catalogue (barcode, then
// name) and to the US label approvals (discover_prefill_known); what they already know (ABV, origin, bottler/importer,
// class, Harmony category, approved brand history, label package) fills empty card fields before any web research,
// so research only looks for what is still missing. Never overwrites a fact.
// v0.5.5: card research backs off when nothing new is found (15 min, 1 h, 1 day, 1 week, 30 days); facts not found
// twice for a bottle are no longer asked for.
// v0.5.4: card research every 15 minutes per product (was 6 hours); daily cap 300 lookups / 3,000 searches.
// v0.5.3: one record per real bottle: the card shows the facts of every record on the same line; research is told what is
// already known and aims at what is new; open "notable_facts" list (grows over time) and "release_history" for limited lines.
// v0.5.2: running total of web searches per product (real count from the API usage), returned on the card.
// v0.5.1: learning loop: every research pass records found/dropped facts and backing sites (discover_research_outcomes);
// research uses only hints a person promoted (discover_research_hints); new "standout" fact (what makes it special).
// v0.5.0: research doubled (scan 6 searches; card 10 as two parallel passes: tasting + story, then other facts); new "history" fact.
// v0.4.3: answer retry no longer fails on signed thinking blocks; facts given at the top level or as JSON text are accepted; logs answer keys.
// v0.4.2: values are written as plain facts (no website or listing names inside a value).
// v0.4.1: tasting summaries kept at confidence 0.5+ (still need a real search URL); card research logs kept/dropped field names.
// v0.4.0: action "card" returns everything known about a product for its profile card (found by exact name,
// else by the product this name was last saved under) and, at most once per product every 6 hours, researches the card's
// empty categories in the background (5 web searches, research budget applies). Brand-only bottles (many
// wines) are now researched too. Every drink gets tasting notes (nose, palate, finish, pairing), researched first and
// summarised in Harmony's own words with source links.
// For a product with no researched facts yet, web research starts in the background: Claude searches
// the web for the exact expression and only facts backed by a URL that the search actually returned
// are stored (evidence + attributes, unreviewed). No images are received or stored.
// Guards: signed-in Discover user (anonymous included), exact-origin allow-list, DEV project only,
// per-minute and per-day save limits, daily research budget, one sighting per identity per session.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const VERSION = "0.6.1";
const PROJECT = "lqqmwqrffelgnbngrkep";
const ORIGINS = [
  /^https:\/\/([a-z0-9-]+--)?harmony-discover\.netlify\.app$/,
  /^https:\/\/([a-z0-9-]+--)?harmony-discover-test\.netlify\.app$/,
];
const MAX_BODY_BYTES = 60_000;
const MAX_BOTTLES = 8;
const MIN_CONFIDENCE = 0.65;
const USER_CALLS_PER_DAY = 300, PROJECT_CALLS_PER_DAY = 3000;
const RESEARCH_SEARCHES = 6;   // doubled with Rob's OK (15 Nov 2026)
// Rob, 15 Nov 2026: a product's card may research again every 15 minutes; at most 300 lookups a day
// (one lookup = one bottle researched once; up to 10 searches each, so at most 3,000 searches a day).
const CARD_RESEARCH_EVERY_S = 900;
const DAILY_LOOKUPS = 300, DAILY_SEARCHES = 3000;
const CATEGORIES = ["tequila", "mezcal", "whiskey", "vodka", "gin", "rum", "brandy", "pisco", "liqueur", "amaro_aperitivo", "vermouth", "wine", "sparkling", "beer", "cider", "non_alcoholic", "non_alcoholic_beer", "other"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The facts worth finding first, per kind of drink (a short list keeps the search focused).
const TASTING = new Set(["tasting_notes", "nose", "palate", "finish", "food_pairing"]);
const STORY = new Set(["tasting_notes", "nose", "palate", "finish", "food_pairing", "history", "standout", "notable_facts", "release_history"]);
// Facts that hold a list and keep growing: new items are added to what is already known.
const LIST_FIELDS = new Set(["notable_facts"]);
const LIST_SEP = " • ";
const COMMON = ["tasting_notes", "nose", "palate", "finish", "history", "standout", "notable_facts", "producer", "brand_owner", "country", "region", "classification", "subcategory", "alcohol_statement"];
const FIELDS_BY_CATEGORY: Record<string, string[]> = {
  whiskey: [...COMMON, "distillery", "state_or_province", "mash_bill", "grain", "age_statement", "cask_type", "cask_finish"],
  tequila: [...COMMON, "distillery", "state_or_province", "agave_type", "production_method", "age_statement", "cask_type"],
  mezcal: [...COMMON, "distillery", "state_or_province", "agave_type", "production_method", "age_statement"],
  rum: [...COMMON, "distillery", "production_method", "distillation", "age_statement", "cask_type"],
  brandy: [...COMMON, "distillery", "appellation", "age_statement", "cask_type", "grapes"],
  pisco: [...COMMON, "distillery", "appellation", "grapes", "production_method"],
  gin: [...COMMON, "distillery", "production_method", "distillation", "style"],
  vodka: [...COMMON, "distillery", "grain", "distillation", "production_method"],
  wine: [...COMMON, "winery", "appellation", "subregion", "grapes", "style", "vintage"],
  sparkling: [...COMMON, "winery", "appellation", "grapes", "production_method", "dosage", "style"],
  beer: [...COMMON, "style", "state_or_province"],
  cider: [...COMMON, "style", "production_method"],
  liqueur: [...COMMON, "flavor", "production_method"],
  amaro_aperitivo: [...COMMON, "production_method", "flavor"],
  vermouth: [...COMMON, "grapes", "style"],
};

const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const unit = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; };
const norm = (v: unknown) => clean(v, 160).toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function originOk(origin: string | null) { return !!origin && ORIGINS.some((re) => re.test(origin)); }
function headers(origin: string | null) {
  const h = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", vary: "Origin" });
  if (originOk(origin)) {
    h.set("access-control-allow-origin", origin!);
    h.set("access-control-allow-headers", "authorization,apikey,content-type");
    h.set("access-control-allow-methods", "POST,OPTIONS");
    h.set("access-control-max-age", "600");
  }
  return h;
}
const reply = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), { status, headers: headers(origin) });

function details(raw: unknown): Record<string, unknown> {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src).slice(0, 60)) {
    if (!/^[a-z_]{2,40}$/.test(key)) continue;
    if (Array.isArray(value)) { const list = value.map((x) => clean(x, 60)).filter(Boolean).slice(0, 8); if (list.length) out[key] = list; }
    else { const v = clean(value, 120); if (v) out[key] = v; }
  }
  return out;
}
function scores(raw: unknown): Record<string, number> {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(src).slice(0, 80)) if (/^[a-z_]{2,40}$/.test(key) && Number.isFinite(Number(value))) out[key] = unit(value);
  return out;
}

// ---------- identity: brand + line + release + size ----------
type Bottle = { brand: string; product: string; category: string; proof: string; size: string; origin: string; words: string[]; details: Record<string, unknown> };
type Resolved = Record<string, unknown> & { status?: string; identity_key?: string | null; line?: string | null; brand?: string | null; release?: Record<string, unknown> | null; size_ml?: number | null; flags?: string[] };

function resolverInput(b: Bottle) {
  const d = b.details;
  const pick = (...keys: string[]) => { for (const k of keys) { const v = d[k]; if (typeof v === "string" && v) return v; } return ""; };
  const detailText = Object.entries(d).filter(([k]) => !k.startsWith("_")).map(([, v]) => Array.isArray(v) ? v.join(" ") : String(v)).join(" ");
  return {
    brand: b.brand, product: b.product, proof: b.proof, size: b.size,
    text: clean([...b.words, detailText].join(" "), 4000),
    gtin: pick("barcode", "upc_ean", "upc", "gtin", "ean"),
    lot_code: pick("lot_code", "laser_code", "bottling_code"),
    age: pick("age_statement"),
  };
}
async function resolveBottle(db: SupabaseClient, b: Bottle): Promise<Resolved | null> {
  const { data, error } = await db.rpc("discover_resolve_bottle", { p: resolverInput(b) });
  if (error || !data || typeof data !== "object") {
    console.log(JSON.stringify({ evt: "resolve_error", msg: clean(error?.message, 160) }));
    return null;
  }
  return data as Resolved;
}
const releaseKey = (r: Resolved | null) => clean((r?.release as Record<string, unknown> | null)?.key, 60) || null;
const releaseLabel = (r: Resolved | null) => clean((r?.release as Record<string, unknown> | null)?.label, 120) || null;

// ---------- web research (same evidence rules as the queue worker) ----------
const normalizeUrl = (value: unknown) => {
  try {
    const u = new URL(String(value ?? ""));
    if (u.protocol !== "https:" || u.username || u.password) return "";
    u.hash = ""; u.search = "";
    return u.toString().replace(/\/$/, "");
  } catch { return ""; }
};
const ENRICHMENT_TOOL = {
  name: "bottle_enrichment",
  description: "Return the requested facts for this exact beverage product, each backed by web search results.",
  input_schema: { type: "object", required: ["fields", "field_confidence", "sources"], properties: {
    fields: { type: "object", additionalProperties: { type: "string" } },
    field_confidence: { type: "object", additionalProperties: { type: "number" } },
    sources: { type: "array", maxItems: 8, items: { type: "object", required: ["url", "title", "supports"], properties: {
      url: { type: "string" }, title: { type: "string" }, supports: { type: "array", items: { type: "string" } },
      source_type: { type: "string", enum: ["manufacturer", "distillery", "winery", "brand_owner", "regulator", "gs1", "retailer", "reference"] },
    } } },
  } },
};

async function research(apiKey: string, model: string, identity: Record<string, unknown>, wanted: string[], labels: Record<string, string> = {}, searches = RESEARCH_SEARCHES, hintText = "", knownText = "") {
  const messages: Array<Record<string, unknown>> = [{ role: "user", content:
    "Find these facts for this exact beverage product.\nPRODUCT: " + JSON.stringify(identity) +
    "\nFACTS WANTED (use exactly these field names): " + wanted.map((f) => labels[f] ? f + " (" + labels[f] + ")" : f).join(", ") +
    "\nSearch the web for the exact brand and product expression. Prefer the producer's own site, then regulators and reputable references; retailers are fine as support. " +
    "Return only facts a search result states for this exact product (not a sibling expression, size or age). Leave out anything you cannot find. " +
    "Tasting fields (tasting_notes, nose, palate, finish, food_pairing): summarise in your own words, at most 35 words each, what the producer's or reviewers' published notes for this product say; never copy their sentences. " +
    "history: in your own words, at most 40 words, the producer's and this bottling's background (founding, people, notable dates). " +
    "standout: in your own words, at most 30 words, what makes this bottle unusual or worth talking about (a method, place, person, record or story). " +
    "notable_facts: up to 5 separate short facts (each at most 25 words) that make this bottle interesting to a drinker: release years and re-releases, limited editions, awards, unusual production details, people, records; join them with \" • \" and never repeat anything under ALREADY KNOWN. " +
    "release_history: in your own words, at most 40 words, when this product was released or re-released (years, batches, ages). " +
    "Write every value as a plain fact for a drinker: never name websites, listings or reviewers inside a value (sources go in sources). " +
    "For every fact give a 0-1 confidence and list the search-result URLs that support it (use field names in supports). Call bottle_enrichment once." + hintText +
    (knownText ? "\nALREADY KNOWN about this product (use it to aim your searches at what is new; do not return it again):\n" + knownText : "") }];
  const all: Array<Record<string, unknown>> = [];
  let input: Record<string, unknown> = {};
  let note = "";
  let searchesUsed = 0;
  const countSearches = (p: Record<string, unknown>) => { searchesUsed += Number((p?.usage as Record<string, Record<string, unknown>> | undefined)?.server_tool_use?.web_search_requests) || 0; };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    for (let turn = 0; turn < 3; turn++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: controller.signal,
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 3000,
          system: "You are a careful beverage product researcher for a drinks catalogue. Search first, then report only facts the search results support for the exact product. Never guess or fill from memory.",
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: searches }, ENRICHMENT_TOOL],
          // "any": every turn uses a tool, so the model ends by calling bottle_enrichment instead of writing prose.
          tool_choice: { type: "any" }, messages }),
      });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error("research_http_" + r.status + " " + clean(p?.error?.message, 120));
      countSearches(p);
      const blocks = Array.isArray(p.content) ? p.content as Array<Record<string, unknown>> : [];
      all.push(...blocks);
      const tool = blocks.find((b) => b.type === "tool_use" && b.name === "bottle_enrichment");
      if (tool && tool.input && typeof tool.input === "object") { input = tool.input as Record<string, unknown>; break; }
      messages.push({ role: "assistant", content: blocks });
      if (p.stop_reason !== "pause_turn" || turn === 2) break;
    }
    // The searches ran but no answer was given: ask once more, now requiring the answer tool.
    if (!Object.keys(input).length && all.some((b) => b.type === "web_search_tool_result")) {
      // Earlier thinking blocks are signed for the first request; drop them (allowed for past turns).
      for (const m of messages) if (m.role === "assistant" && Array.isArray(m.content)) m.content = (m.content as Array<Record<string, unknown>>).filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
      messages.push({ role: "user", content: "Now call bottle_enrichment with the facts the search results above support for this exact product." });
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: controller.signal,
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 3000,
          system: "You are a careful beverage product researcher for a drinks catalogue. Report only facts the search results support for the exact product. Never guess or fill from memory.",
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }, ENRICHMENT_TOOL],
          tool_choice: { type: "tool", name: "bottle_enrichment" }, messages }),
      });
      const p = await r.json().catch(() => ({}));
      countSearches(p);
      const blocks = Array.isArray(p.content) ? p.content as Array<Record<string, unknown>> : [];
      const tool = blocks.find((b) => b.type === "tool_use" && b.name === "bottle_enrichment");
      if (r.ok && tool && tool.input && typeof tool.input === "object") input = tool.input as Record<string, unknown>;
      else note = "final_" + r.status + "_" + clean(p?.error?.message ?? p?.stop_reason, 80);
    }
  } finally { clearTimeout(timer); }
  // Nested parts sometimes arrive as JSON text: read them as objects.
  for (const k of ["fields", "field_confidence", "sources"]) {
    if (typeof input[k] === "string") { try { input[k] = JSON.parse(input[k] as string); } catch { /* left as is */ } }
  }
  const found = new Map<string, string>();
  for (const b of all) {
    if (b.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue;
    for (const row of b.content as Array<Record<string, unknown>>) { const u = normalizeUrl(row.url); if (u) found.set(u, clean(row.title, 180)); }
  }
  const allowed = new Set(wanted);
  const sources: Array<{ url: string; title: string; supports: string[]; kind: string }> = [];
  const supported = new Set<string>();
  // Cited URLs are matched loosely to the URLs the search really returned (www., http/https, trailing
  // slash, case); a citation of the same site as a returned page counts as that page.
  const key = (v: string) => { try { const x = new URL(v); return x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "").toLowerCase(); } catch { return ""; } };
  const host = (v: string) => { try { return new URL(v).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const byKey = new Map([...found.keys()].map((u) => [key(u), u]));
  const byHost = new Map([...found.keys()].map((u) => [host(u), u]));
  const resolveCited = (raw: unknown) => {
    const text = String(raw ?? "");
    const n = normalizeUrl(text.startsWith("http") ? text : "https://" + text);
    if (!n) return "";
    if (found.has(n)) return n;
    return byKey.get(key(n)) ?? byHost.get(host(n)) ?? "";
  };
  for (const s of (Array.isArray(input.sources) ? input.sources : []).slice(0, 8) as Array<Record<string, unknown>>) {
    const u = resolveCited(s.url);
    if (!u || sources.some((x) => x.url === u)) continue;   // only URLs the search really returned
    const supports = [...new Set((Array.isArray(s.supports) ? s.supports : []).map((x) => String(x).trim()).filter((x) => allowed.has(x)))];
    supports.forEach((f) => supported.add(f));
    sources.push({ url: u, title: found.get(u) || clean(s.title, 180), supports, kind: String(s.source_type || "reference") });
  }
  // Facts normally sit under "fields"; some answers put them at the top level instead.
  const topLevel = Object.fromEntries(Object.entries(input).filter(([k, v]) => allowed.has(k) && typeof v === "string"));
  const nested = input.fields && typeof input.fields === "object" && !Array.isArray(input.fields) ? input.fields as Record<string, unknown> : {};
  const rawFields = (Object.keys(nested).length ? nested : topLevel) as Record<string, unknown>;
  const rawScores = (input.field_confidence && typeof input.field_confidence === "object" ? input.field_confidence : {}) as Record<string, unknown>;
  const facts: Record<string, { value: string; confidence: number }> = {};
  const dropped: Record<string, string> = {};
  // A fact needs a real search-result URL that the answer itself cites for that fact, and a score the
  // answer gave (FIX-003: no borrowed sources, no default score). Tasting summaries are judgement by
  // nature, so they need 0.5 (still source-backed); hard facts need 0.7.
  for (const [field, value] of Object.entries(rawFields)) {
    const scored = rawScores[field] !== undefined && rawScores[field] !== null && rawScores[field] !== "" && Number.isFinite(Number(rawScores[field]));
    const v = clean(value, LIST_FIELDS.has(field) ? 700 : 240), c = scored ? unit(rawScores[field]) : 0;
    const floor = TASTING.has(field) ? 0.5 : LIST_FIELDS.has(field) ? 0.6 : 0.7;
    const why = !allowed.has(field) ? "not_wanted" : !v ? "empty" : !scored ? "no_score" : c < floor ? "low_" + c.toFixed(2) : !supported.has(field) ? "no_source" : "";
    if (why) { dropped[clean(field, 40)] = why; continue; }
    facts[field] = { value: v, confidence: c };
  }
  return { facts, dropped, sources: sources.filter((s) => s.supports.some((f) => facts[f])), searchResults: found.size, rawFields: Object.keys(rawFields).length, validSources: sources.length, note, searchesUsed, inputKeys: Object.keys(input).slice(0, 8).map((k) => clean(k, 30)) };
}

// ---------- learning loop: record what research found; use only hints a person has promoted ----------
type Hints = { text: string; skip: Set<string> };
async function loadHints(db: SupabaseClient, category: string): Promise<Hints> {
  const { data } = await db.from("discover_research_hints").select("kind,value").eq("category", category).eq("status", "promoted").limit(40);
  const rows = (data ?? []) as Array<{ kind: string; value: string }>;
  const hosts = rows.filter((r) => r.kind === "source_host").map((r) => clean(r.value, 80)).slice(0, 8);
  const lookFor = rows.filter((r) => r.kind === "look_for").map((r) => clean(r.value, 120)).slice(0, 8);
  const skip = new Set(rows.filter((r) => r.kind === "skip_field").map((r) => r.value));
  let text = "";
  if (hosts.length) text += "\nSites that have reliably covered this kind of drink (try them, still verify): " + hosts.join(", ") + ".";
  if (lookFor.length) text += "\nAlso worth looking for with this kind of drink: " + lookFor.join("; ") + ".";
  return { text, skip };
}
async function recordOutcomes(db: SupabaseClient, productId: string, category: string, wanted: string[], result: Awaited<ReturnType<typeof research>>, kind: string) {
  const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
  const rows = wanted.map((field) => {
    const fact = result.facts[field];
    const src = fact ? result.sources.find((x) => x.supports.includes(field)) : undefined;
    return {
      discover_product_id: productId, category, field, research_kind: kind, model_version: VERSION,
      outcome: fact ? "kept" : result.dropped[field] ? "dropped" : "not_returned",
      reason: fact ? null : result.dropped[field] ?? null,
      confidence: fact?.confidence ?? null,
      source_host: src ? hostOf(src.url) : null, source_kind: src?.kind ?? null,
    };
  });
  if (rows.length) { const { error } = await db.from("discover_research_outcomes").insert(rows); if (error) console.log(JSON.stringify({ evt: "outcome_record_error", msg: clean(error.message, 120) })); }
}

const evidenceSourceType = (kind: string, url: string) => {
  if (["manufacturer", "distillery", "winery", "brand_owner"].includes(kind)) return "official_producer";
  if (kind === "regulator") { const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })(); return /ttb(online)?\.gov$/.test(host) ? "ttb_cola" : "government_registry"; }
  if (kind === "gs1") return "barcode_registry";
  if (kind === "retailer") return "retailer";
  return "web_search";
};

async function researchProduct(db: SupabaseClient, apiKey: string, subject: string, productId: string, sightingId: string, b: { brand: string; product: string; category: string; proof: string; size: string; details: Record<string, unknown> }) {
  const started = Date.now();
  // Claim the queued research job so the minute worker does not repeat it.
  const { data: claimed } = await db.from("discover_enrichment_jobs").update({ status: "processing", locked_at: new Date().toISOString(), locked_by: "live-autosave", attempts: 1, updated_at: new Date().toISOString() })
    .eq("discover_product_id", productId).eq("job_type", "official_source_lookup").in("status", ["queued", "retry"]).select("id");
  const jobId = Array.isArray(claimed) && claimed[0]?.id ? String(claimed[0].id) : null;
  if (!jobId) return;
  const finish = async (output: Record<string, unknown>, status = "complete") => {
    await db.from("discover_enrichment_jobs").update({ status, output_payload: output, locked_at: null, locked_by: null, updated_at: new Date().toISOString(), ...(status === "retry" ? { available_at: new Date(Date.now() + 60_000).toISOString() } : {}) }).eq("id", jobId);
  };
  try {
    const { data: existing } = await db.from("discover_product_attributes").select("attribute_code").eq("discover_product_id", productId);
    const have = new Set((existing ?? []).map((r: { attribute_code: string }) => r.attribute_code));
    const hints = await loadHints(db, b.category);
    const wanted = (FIELDS_BY_CATEGORY[b.category] ?? COMMON).filter((f) => !have.has(f) && !clean(b.details[f], 80) && !hints.skip.has(f));
    if (!wanted.length) return await finish({ result: "no_missing_research_fields", by: "live-autosave" });
    const { data: budgetOk, error: budgetError } = await db.rpc("discover_reserve_bottle_research_budget", {
      p_consumer: subject, p_jobs: 1, p_search_units: RESEARCH_SEARCHES,
      p_user_jobs_max: DAILY_LOOKUPS, p_project_jobs_max: DAILY_LOOKUPS, p_user_search_max: DAILY_SEARCHES, p_project_search_max: DAILY_SEARCHES,
    });
    if (budgetError || budgetOk !== true) return await finish({ result: "research_budget_exhausted", by: "live-autosave" }, "retry");
    const model = Deno.env.get("DISCOVER_RESEARCH_MODEL") || Deno.env.get("DISCOVER_BOTTLE_MODEL") || "claude-haiku-5-5";
    const identity = { brand: b.brand, product: b.product, category: b.category, proof: b.proof || undefined, size: b.size || undefined };
    const result = await research(apiKey, model, identity, wanted, {}, RESEARCH_SEARCHES, hints.text);
    await recordOutcomes(db, productId, b.category, wanted, result, "scan");
    await db.rpc("discover_add_product_searches", { p_product: productId, p_searches: result.searchesUsed });
    const evidenceRows: Array<Record<string, unknown>> = [];
    for (const [field, fact] of Object.entries(result.facts)) {
      for (const s of result.sources.filter((x) => x.supports.includes(field)).slice(0, 2)) {
        evidenceRows.push({ discover_product_id: productId, attribute_code: field, source_type: evidenceSourceType(s.kind, s.url),
          source_name: s.title || "Web research source", source_url: s.url, observed_value: { value: fact.value, attribute_code: field, product_expression: b.product },
          confidence: fact.confidence, verification_state: "unreviewed", metadata: { sighting_id: sightingId, researched_by: "live-autosave", supports: [field] } });
      }
    }
    let attributes = 0;
    if (evidenceRows.length) {
      const { data: inserted, error } = await db.from("discover_product_evidence").insert(evidenceRows).select("id,attribute_code");
      if (error || !Array.isArray(inserted)) throw new Error("evidence_insert_failed");
      const firstEvidence = new Map<string, string>();
      for (const row of inserted) if (!firstEvidence.has(row.attribute_code)) firstEvidence.set(row.attribute_code, row.id);
      const rows = [...firstEvidence.entries()].map(([field, evidenceId]) => ({ discover_product_id: productId, attribute_code: field, value_text: result.facts[field]!.value, state: "found", confidence: result.facts[field]!.confidence, evidence_id: evidenceId }));
      const { error: attrError } = await db.from("discover_product_attributes").upsert(rows, { onConflict: "discover_product_id,attribute_code", ignoreDuplicates: true });
      if (attrError) throw new Error("attribute_insert_failed");
      attributes = rows.length;
    }
    await finish({ result: attributes ? "research_complete" : "no_verified_research", by: "live-autosave", researched_fields: Object.keys(result.facts), attributes_added: attributes, evidence_saved: evidenceRows.length, search_results: result.searchResults, ms: Date.now() - started });
    console.log(JSON.stringify({ evt: "live_research", attributes, evidence: evidenceRows.length, search_results: result.searchResults, ms: Date.now() - started }));
  } catch (error) {
    console.log(JSON.stringify({ evt: "live_research_error", msg: clean(error instanceof Error ? error.message : error, 160) }));
    await finish({ result: "live_research_failed", by: "live-autosave" }, "retry");
  }
}

// ---------- v0.6.0: what Harmony and the US label register already know goes on the card first ----------
async function prefillKnown(db: SupabaseClient, productId: string) {
  const started = Date.now();
  const { data, error } = await db.rpc("discover_prefill_known", { p_product: productId });
  if (error) { console.log(JSON.stringify({ evt: "prefill_known_error", msg: clean(error.message, 160) })); return null; }
  const d = (data ?? {}) as Record<string, Record<string, unknown> | null>;
  console.log(JSON.stringify({ evt: "prefill_known", harmony_facts: d.harmony?.facts_added ?? 0, label: d.label?.ok ?? null,
    label_facts: d.label_facts?.facts_added ?? 0, ms: Date.now() - started }));
  return data;
}

// ---------- product card: everything known about the product, and research for what is missing ----------
const CARD_SEARCHES = 10;   // doubled with Rob's OK: two 5-search passes (tasting + story, then the other facts)
async function storeFacts(db: SupabaseClient, productId: string, product: string, result: Awaited<ReturnType<typeof research>>, meta: Record<string, unknown>) {
  const evidenceRows: Array<Record<string, unknown>> = [];
  for (const [field, fact] of Object.entries(result.facts)) {
    for (const s of result.sources.filter((x) => x.supports.includes(field)).slice(0, 2)) {
      evidenceRows.push({ discover_product_id: productId, attribute_code: field, source_type: evidenceSourceType(s.kind, s.url),
        source_name: s.title || "Web research source", source_url: s.url, observed_value: { value: fact.value, attribute_code: field, product_expression: product },
        confidence: fact.confidence, verification_state: "unreviewed", metadata: { ...meta, supports: [field] } });
    }
  }
  if (!evidenceRows.length) return 0;
  const { data: inserted, error } = await db.from("discover_product_evidence").insert(evidenceRows).select("id,attribute_code");
  if (error || !Array.isArray(inserted)) throw new Error("evidence_insert_failed");
  const firstEvidence = new Map<string, string>();
  for (const row of inserted) if (!firstEvidence.has(row.attribute_code)) firstEvidence.set(row.attribute_code, row.id);
  const rows = [...firstEvidence.entries()].map(([field, evidenceId]) => ({ discover_product_id: productId, attribute_code: field, value_text: result.facts[field]!.value, state: "found", confidence: result.facts[field]!.confidence, evidence_id: evidenceId }));
  // List facts grow: new items are added to the ones already stored (duplicates skipped, at most 12 kept).
  let unchangedLists = 0;
  for (const row of rows.filter((r) => LIST_FIELDS.has(r.attribute_code))) {
    const { data: old } = await db.from("discover_product_attributes").select("value_text").eq("discover_product_id", productId).eq("attribute_code", row.attribute_code).maybeSingle();
    if (!old?.value_text) continue;
    const items = String(old.value_text).split(LIST_SEP).map((x) => x.trim()).filter(Boolean);
    const seen = new Set(items.map((x) => norm(x)));
    const before = items.length;
    for (const item of String(row.value_text).split(LIST_SEP).map((x) => x.trim()).filter(Boolean)) if (!seen.has(norm(item))) { items.push(item); seen.add(norm(item)); }
    if (items.length === before) unchangedLists += 1;
    await db.from("discover_product_attributes").update({ value_text: items.slice(0, 12).join(LIST_SEP), updated_at: new Date().toISOString() }).eq("discover_product_id", productId).eq("attribute_code", row.attribute_code);
  }
  const { error: attrError } = await db.from("discover_product_attributes").upsert(rows, { onConflict: "discover_product_id,attribute_code", ignoreDuplicates: true });
  if (attrError) throw new Error("attribute_insert_failed");
  return rows.length - unchangedLists;   // new facts (a list that gained nothing does not count)
}

// What the card already knows, as short lines for the research prompt (so searches aim at what is new).
function knownSummary(attributes: Array<Record<string, unknown>>, line: Record<string, unknown> | null) {
  const lines = attributes.filter((a) => a.value_text).map((a) => String(a.attribute_code) + ": " + clean(a.value_text, 160));
  if (line?.release_pattern && line.release_pattern !== "continuous") lines.push("release pattern: " + clean(line.release_pattern, 40));
  if (line?.notes) lines.push("catalogue note: " + clean(line.notes, 200));
  return lines.join("\n").slice(0, 2500);
}

async function findProduct(db: SupabaseClient, brand: string, product: string): Promise<Record<string, unknown> | null> {
  const { data: exact } = await db.rpc("discover_find_exact_product", { p_brand: brand, p_product: product });
  if (Array.isArray(exact) && exact.length === 1) return exact[0] as Record<string, unknown>;
  // Otherwise the product this name was saved under most recently (same brand; same expression first).
  const { data: seen } = await db.from("bottle_sightings").select("discover_product_id,read_brand,read_product")
    .not("discover_product_id", "is", null).ilike("read_brand", brand.replace(/[%_\\]/g, "")).order("created_at", { ascending: false }).limit(40);
  const rows = (seen ?? []).filter((r: Record<string, unknown>) => norm(r.read_brand) === norm(brand));
  const pick = rows.find((r: Record<string, unknown>) => norm(r.read_product) === norm(product)) ?? rows[0];
  if (!pick) return null;
  const { data: row } = await db.from("discover_products").select("*").eq("id", pick.discover_product_id).maybeSingle();
  return row ?? null;
}

async function productCard(db: SupabaseClient, apiKey: string, subject: string, body: Record<string, unknown>, origin: string | null) {
  const brand = clean(body.brand, 80), product = clean(body.product, 80);
  const category = CATEGORIES.includes(String(body.category)) ? String(body.category) : "other";
  if (!brand) return reply({ error: "brand_required" }, 400, origin);
  const { data: okRate, error: rateErr } = await db.rpc("discover_rate_limit", { p_subject: subject, p_bucket: "product_card", p_max: 60, p_window_seconds: 60 });
  if (rateErr || okRate !== true) return reply({ error: rateErr ? "rate_limit_unavailable" : "rate_limited" }, rateErr ? 503 : 429, origin);
  const found = await findProduct(db, brand, product);
  if (!found) return reply({ ok: true, found: false, researching: false }, 200, origin);
  const productId = String(found.id);
  await prefillKnown(db, productId);
  // A bottle's line (e.g. Taylor Barrel Proof) shares its facts: this record first, then other records of the same line.
  const lineId = found.discover_line_id ? String(found.discover_line_id) : null;
  const [{ data: family }, { data: line }] = await Promise.all([
    lineId ? db.from("discover_products").select("id").eq("discover_line_id", lineId).limit(20) : Promise.resolve({ data: [] as Array<{ id: string }> }),
    lineId ? db.from("discover_brand_lines").select("line_name,release_pattern,notes").eq("id", lineId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const familyIds = [productId, ...((family ?? []) as Array<{ id: string }>).map((r) => String(r.id)).filter((id) => id !== productId)];
  const [{ data: allAttributes }, { data: evidence }, { data: packages }, { count: total }, { data: usage }] = await Promise.all([
    db.from("discover_product_attributes").select("discover_product_id,attribute_code,value_text,value_numeric,value_json,unit,state,confidence,evidence_id,updated_at").in("discover_product_id", familyIds).limit(300),
    db.from("discover_product_evidence").select("attribute_code,source_type,source_name,source_url,observed_value,confidence,verification_state,captured_at,expires_at,metadata").in("discover_product_id", familyIds).order("captured_at", { ascending: false }).limit(60),
    db.from("discover_product_packages").select("package_size_ml,abv_percent,package_type,container_material,upc_gtin,ean,label_approval_id,package_payload").eq("discover_product_id", productId).limit(12),
    db.from("bottle_sightings").select("id", { count: "exact", head: true }).in("discover_product_id", familyIds),
    db.from("discover_product_search_usage").select("discover_product_id,searches,research_runs,last_research_at,next_research_at").in("discover_product_id", familyIds),
  ]);
  // Facts this bottle's research already failed to find twice are not asked for again (stories always are).
  const { data: misses } = await db.from("discover_research_outcomes").select("field,outcome").in("discover_product_id", familyIds).limit(1000);
  const missCount = new Map<string, number>(), foundOnce = new Set<string>();
  for (const r of (misses ?? []) as Array<{ field: string; outcome: string }>) {
    if (r.outcome === "kept") foundOnce.add(r.field); else missCount.set(r.field, (missCount.get(r.field) ?? 0) + 1);
  }
  const givenUp = new Set([...missCount.entries()].filter(([f, n]) => n >= 2 && !foundOnce.has(f) && !LIST_FIELDS.has(f)).map(([f]) => f));
  const attributes: Array<Record<string, unknown>> = [];
  for (const id of familyIds) for (const a of (allAttributes ?? []) as Array<Record<string, unknown>>) {
    if (String(a.discover_product_id) !== id || attributes.some((x) => x.attribute_code === a.attribute_code)) continue;
    const { discover_product_id: _p, ...rest } = a; attributes.push(rest);
  }
  // List facts are combined across the line's records (each item once).
  for (const field of LIST_FIELDS) {
    const items: string[] = [];
    for (const a of (allAttributes ?? []) as Array<Record<string, unknown>>) {
      if (a.attribute_code !== field) continue;
      for (const item of String(a.value_text || "").split(LIST_SEP).map((x) => x.trim()).filter(Boolean)) if (!items.some((x) => norm(x) === norm(item))) items.push(item);
    }
    const target = attributes.find((x) => x.attribute_code === field);
    if (target && items.length) target.value_text = items.slice(0, 12).join(LIST_SEP);
  }
  const usageRows = (usage ?? []) as Array<Record<string, unknown>>;
  const searchesTotal = usageRows.reduce((n, r) => n + (Number(r.searches) || 0), 0);
  const runsTotal = usageRows.reduce((n, r) => n + (Number(r.research_runs) || 0), 0);
  const lastAt = usageRows.map((r) => String(r.last_research_at || "")).sort().pop() || null;
  // Fill what the card is missing: in the background, within the research budget.
  const have = new Set(attributes.map((a) => String(a.attribute_code)));
  const labels: Record<string, string> = {};
  for (const f of (Array.isArray(body.fields) ? body.fields : []).slice(0, 40) as Array<Record<string, unknown>>) {
    const key = clean(f?.key, 40), label = clean(f?.label, 60);
    if (/^[a-z_]{2,40}$/.test(key) && !have.has(key) && !givenUp.has(key)) labels[key] = label || key;
  }
  // Stories keep growing: always look for new notable facts (limited releases also get their release history).
  labels.notable_facts = labels.notable_facts || "Stories & notable facts";
  if (line?.release_pattern && line.release_pattern !== "continuous" && !have.has("release_history")) labels.release_history = labels.release_history || "Release history";
  const wanted = Object.keys(labels).slice(0, 32);
  let researching = false;
  // Waits grow when research stops finding anything new: 15 min, 1 hour, 1 day, 1 week, 30 days.
  const own = usageRows.find((r) => String(r.discover_product_id) === productId);
  const waiting = !!own?.next_research_at && Date.parse(String(own.next_research_at)) > Date.now();
  // At most one card research per product every 15 minutes (keyed on the product, not the person).
  const tryResearch = wanted.length >= 3 && !!apiKey && !waiting
    && (await db.rpc("discover_rate_limit", { p_subject: productId, p_bucket: "card_research", p_max: 1, p_window_seconds: CARD_RESEARCH_EVERY_S })).data === true;
  if (tryResearch) {
    const { data: budgetOk } = await db.rpc("discover_reserve_bottle_research_budget", {
      p_consumer: subject, p_jobs: 1, p_search_units: CARD_SEARCHES,
      p_user_jobs_max: DAILY_LOOKUPS, p_project_jobs_max: DAILY_LOOKUPS, p_user_search_max: DAILY_SEARCHES, p_project_search_max: DAILY_SEARCHES,
    });
    if (budgetOk === true) {
      researching = true;
      const task = (async () => {
        const started = Date.now();
        try {
          const model = Deno.env.get("DISCOVER_RESEARCH_MODEL") || Deno.env.get("DISCOVER_BOTTLE_MODEL") || "claude-haiku-5-5";
          const identity = { brand: String(found.brand_name || brand), product: String(found.product_name || product), category };
          // Two focused passes run side by side: how it tastes + its story, then everything else.
          const hints = await loadHints(db, category);
          const useful = wanted.filter((f) => !hints.skip.has(f));
          const groups = [useful.filter((f) => STORY.has(f)), useful.filter((f) => !STORY.has(f))].filter((g) => g.length);
          const per = Math.floor(CARD_SEARCHES / groups.length);
          let newFacts = 0;
          await Promise.all(groups.map(async (group, i) => {
            const result = await research(apiKey, model, identity, group, labels, per, hints.text, knownSummary(attributes, line as Record<string, unknown> | null));
            await recordOutcomes(db, productId, category, group, result, "card");
            await db.rpc("discover_add_product_searches", { p_product: productId, p_searches: result.searchesUsed });
            const added = await storeFacts(db, productId, identity.product, result, { researched_by: "card", pass: i + 1 });
            newFacts += added;
            console.log(JSON.stringify({ evt: "card_research", pass: groups.length > 1 ? i + 1 : 0, wanted: group.length, raw_fields: result.rawFields, kept: Object.keys(result.facts), dropped: result.dropped, input_keys: result.inputKeys, valid_sources: result.validSources, note: result.note, attributes: added, searches: result.searchesUsed, search_results: result.searchResults, ms: Date.now() - started }));
          }));
          await db.rpc("discover_note_research_result", { p_product: productId, p_new_facts: newFacts });
        } catch (error) {
          console.log(JSON.stringify({ evt: "card_research_error", msg: clean(error instanceof Error ? error.message : error, 160) }));
        }
      })();
      const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(task); else await task;
    }
  }
  return reply({
    ok: true, found: true, researching,
    product: { id: productId, brand: found.brand_name, product: found.product_name, category: found.product_class || category, expression: found.expression_variant, upc_gtin: found.upc_gtin, ean: found.ean, status: found.status, match_confidence: found.match_confidence, identity: found.identity_payload || {} },
    packages: packages ?? [], attributes: attributes ?? [],
    evidence: (evidence ?? []).map((e: Record<string, unknown>) => { const { metadata: _m, ...rest } = e; return rest; }),
    sightings: { total: total || 0, confirmed: 0 },
    research: { searches_total: searchesTotal, runs: runsTotal, last_at: lastAt, researching_now: researching, next_at: own?.next_research_at ?? null, skipped_fields: [...givenUp].slice(0, 20) },
  }, 200, origin);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!originOk(origin)) return reply({ error: "origin_not_allowed" }, 403, null);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405, origin);

  const url = Deno.env.get("SUPABASE_URL") || "";
  try { if (new URL(url).hostname !== PROJECT + ".supabase.co") return reply({ error: "environment_refused" }, 503, origin); }
  catch { return reply({ error: "environment_refused" }, 503, origin); }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return reply({ error: "configuration_missing" }, 503, origin);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";

  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return reply({ error: "unauthorized" }, 401, origin);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await db.auth.getUser(bearer);
  if (authError || !auth?.user) return reply({ error: "unauthorized" }, 401, origin);
  const subject = auth.user.id;

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return reply({ error: "payload_too_large" }, 413, origin);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); }
  catch { return reply({ error: "invalid_json" }, 400, origin); }
  if (body.action === "health") return reply({ ok: true, version: VERSION }, 200, origin);
  if (body.action === "card") return await productCard(db, apiKey, subject, body, origin);

  const session = String(body.scan_session_id || "");
  if (!UUID.test(session)) return reply({ error: "scan_session_id_required" }, 400, origin);
  const bottles = (Array.isArray(body.bottles) ? body.bottles as Array<Record<string, unknown>> : []).slice(0, MAX_BOTTLES).map((b) => ({
    brand: clean(b.brand, 80), product: clean(b.product, 80),
    category: CATEGORIES.includes(String(b.category)) ? String(b.category) : "other",
    proof: clean(b.proof, 30), size: clean(b.size, 30), origin: clean(b.origin, 60),
    words: (Array.isArray(b.words) ? b.words : []).map((w) => clean(w, 40)).filter(Boolean).slice(0, 8),
    confidence: unit(b.confidence), agreeing_reads: Math.max(0, Math.min(50, Math.floor(Number(b.agreeing_reads) || 0))),
    details: details(b.details), field_confidence: scores(b.field_confidence),
  })).filter((b) => b.brand && b.confidence >= MIN_CONFIDENCE);
  if (!bottles.length) return reply({ ok: true, saved: 0, skipped: 0, results: [] }, 200, origin);

  const { data: minuteOk, error: minuteErr } = await db.rpc("discover_rate_limit", { p_subject: subject, p_bucket: "live_autosave", p_max: 20, p_window_seconds: 60 });
  if (minuteErr || minuteOk !== true) return reply({ error: minuteErr ? "rate_limit_unavailable" : "rate_limited" }, minuteErr ? 503 : 429, origin);
  const { data: dayOk, error: dayErr } = await db.rpc("discover_bottle_save_allow", { p_subject: subject, p_user_max: USER_CALLS_PER_DAY, p_global_max: PROJECT_CALLS_PER_DAY });
  if (dayErr || dayOk !== true) return reply({ error: dayErr ? "daily_limit_unavailable" : "daily_limit_reached" }, dayErr ? 503 : 429, origin);

  const { data: existing, error: existingErr } = await db.from("bottle_sightings")
    .select("read_brand,read_product,label_details").eq("consumer_id", subject).eq("scan_session_id", session).limit(500);
  if (existingErr) return reply({ error: "lookup_failed" }, 503, origin);
  const seen = new Set<string>();
  for (const r of existing ?? []) {
    seen.add(norm(r.read_brand) + "|" + norm(r.read_product));
    const id = (r.label_details as Record<string, Record<string, unknown>> | null)?._identity?.identity_key;
    if (typeof id === "string" && id) seen.add("id:" + id);
  }

  const venue = clean(body.venue_name, 120) || null;
  const results: Array<Record<string, unknown>> = [];
  const researchTasks: Promise<void>[] = [];
  for (const b of bottles) {
    const resolved = await resolveBottle(db, b);
    const matched = resolved?.status === "matched" && typeof resolved.identity_key === "string" && !!resolved.identity_key;
    const nameKey = norm(b.brand) + "|" + norm(b.product);
    const idKey = matched ? "id:" + resolved!.identity_key : null;
    const identity = resolved ? {
      status: resolved.status ?? null, identity_key: resolved.identity_key ?? null,
      brand: resolved.brand ?? null, line: resolved.line ?? null,
      release_key: releaseKey(resolved), release_label: releaseLabel(resolved),
      size_ml: typeof resolved.size_ml === "number" ? resolved.size_ml : null,
      flags: Array.isArray(resolved.flags) ? resolved.flags : [],
      shape_key: null as string | null,
    } : null;
    // The glass is the same across releases: liquid-level calibration belongs to brand|line|size.
    if (identity && identity.line && identity.size_ml && !identity.flags.includes("barcode_and_label_words_disagree")) {
      identity.shape_key = [norm(identity.brand), norm(identity.line), Math.round(identity.size_ml) + "ml"].join("|");
    }
    if ((idKey && seen.has(idKey)) || seen.has(nameKey)) { results.push({ brand: b.brand, product: b.product, status: "already_saved", identity }); continue; }
    seen.add(nameKey); if (idKey) seen.add(idKey);
    const vintage = /^(18|19|20)\d{2}$/.test(String(b.details.vintage || "")) ? Number(b.details.vintage) : null;
    const fieldConfidence = { brand: b.confidence, ...b.field_confidence };
    const { data: inserted, error: insertError } = await db.from("bottle_sightings").insert({
      consumer_id: subject, scan_session_id: session, venue_name_submitted: venue,
      read_brand: b.brand, read_product: b.product || null, read_category: b.category,
      read_proof: b.proof || null, read_size: b.size || null, read_vintage: vintage,
      label_text: b.words.join(" ") || null,
      label_details: { ...b.details, ...(b.origin ? { origin: b.origin } : {}), _field_confidence: fieldConfidence, _live: { agreeing_reads: b.agreeing_reads, auto_saved: true } },
      read_confidence: b.confidence, method: "vision_frame", evidence_state: "reported",
      reader: "discover-live-autosave", reader_version: VERSION, read_model: "live-consensus",
    }).select("id").single();
    if (insertError || !inserted) {
      console.log(JSON.stringify({ evt: "autosave_insert_error", msg: clean(insertError?.message, 160) }));
      results.push({ brand: b.brand, product: b.product, status: "failed", identity });
      continue;
    }
    let productId: string | null = null, created = false;
    if (resolved) {
      const { data: linked, error: linkError } = await db.rpc("discover_attach_resolved_sighting", { p_sighting_id: inserted.id, p_resolved: resolved });
      const link = Array.isArray(linked) ? linked[0] : linked;
      if (linkError) console.log(JSON.stringify({ evt: "autosave_link_error", msg: clean(linkError.message, 160) }));
      productId = link?.r_product_id ? String(link.r_product_id) : null;
      created = link?.r_created === true;
      if (identity && typeof link?.r_shape_key === "string") identity.shape_key = link.r_shape_key;
    } else {
      const { data: linked, error: linkError } = await db.rpc("discover_attach_sighting_to_product", { p_sighting_id: inserted.id });
      const link = Array.isArray(linked) ? linked[0] : linked;
      if (linkError) console.log(JSON.stringify({ evt: "autosave_link_error", msg: clean(linkError.message, 160) }));
      productId = link?.discover_product_id ? String(link.discover_product_id) : null;
      created = link?.created_new === true;
    }
    // Research the exact expression: resolved brand + line (+ release), never the category words.
    const researchBottle = matched
      ? { ...b, brand: String(resolved!.brand || b.brand), product: [resolved!.line, releaseKey(resolved) !== "standard" ? releaseLabel(resolved) : null].filter(Boolean).join(", ") }
      : b;
    const canResearch = !!(productId && apiKey && researchBottle.brand);
    // Known facts first (Harmony catalogue + US label approval), then web research only for what is still missing.
    if (productId) researchTasks.push((async () => {
      await prefillKnown(db, productId!);
      if (canResearch) await researchProduct(db, apiKey, subject, productId!, String(inserted.id), researchBottle);
    })());
    results.push({ brand: b.brand, product: b.product, status: "saved", sighting_id: inserted.id, product_id: productId, new_product: created, researching: canResearch, identity });
  }
  // Research continues after the reply so the scanner is never kept waiting.
  if (researchTasks.length) {
    const background = Promise.allSettled(researchTasks).then(() => undefined);
    const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(background); else await background;
  }
  const saved = results.filter((r) => r.status === "saved").length;
  console.log(JSON.stringify({ evt: "autosave_result", version: VERSION, received: bottles.length, saved, resolved: results.filter((r) => (r.identity as Record<string, unknown> | null)?.status === "matched").length, new_products: results.filter((r) => r.new_product).length, researching: researchTasks.length }));
  return reply({ ok: true, version: VERSION, saved, skipped: results.length - saved, results }, 200, origin);
});
