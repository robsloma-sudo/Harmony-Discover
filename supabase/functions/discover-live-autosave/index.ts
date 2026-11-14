// Harmony Discover DEV: discover-live-autosave v0.3.0
// Saves bottles the live scanner is SURE of (reads agreed on the name) as sightings, for people
// who switched on Live Recognition (its consent text says sightings are saved).
// v0.3.0: every bottle is first resolved to brand + line + release + size (discover_resolve_bottle):
// category words are never used as the product name, the barcode picks the line, proof + laser lot
// code pick the release. Resolved bottles link to one Discover product per identity; the reply
// carries the identity and a shape key (brand|line|size) that liquid-level calibration uses.
// Unresolved bottles use the previous attach path unchanged.
// For a product with no researched facts yet, web research starts in the background: Claude searches
// the web for the exact expression and only facts backed by a URL that the search actually returned
// are stored (evidence + attributes, unreviewed). No images are received or stored.
// Guards: signed-in Discover user (anonymous included), exact-origin allow-list, DEV project only,
// per-minute and per-day save limits, daily research budget, one sighting per identity per session.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const VERSION = "0.3.0";
const PROJECT = "lqqmwqrffelgnbngrkep";
const ORIGINS = [
  /^https:\/\/([a-z0-9-]+--)?harmony-discover\.netlify\.app$/,
  /^https:\/\/([a-z0-9-]+--)?harmony-discover-test\.netlify\.app$/,
];
const MAX_BODY_BYTES = 60_000;
const MAX_BOTTLES = 8;
const MIN_CONFIDENCE = 0.65;
const USER_CALLS_PER_DAY = 300, PROJECT_CALLS_PER_DAY = 3000;
const RESEARCH_SEARCHES = 3;
const CATEGORIES = ["tequila", "mezcal", "whiskey", "vodka", "gin", "rum", "brandy", "pisco", "liqueur", "amaro_aperitivo", "vermouth", "wine", "sparkling", "beer", "cider", "non_alcoholic", "non_alcoholic_beer", "other"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The facts worth finding first, per kind of drink (a short list keeps the search focused).
const COMMON = ["producer", "brand_owner", "country", "region", "classification", "subcategory", "alcohol_statement"];
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
const norm = (v: unknown) => clean(v, 160).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

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

async function research(apiKey: string, model: string, identity: Record<string, unknown>, wanted: string[]) {
  const messages: Array<Record<string, unknown>> = [{ role: "user", content:
    "Find these facts for this exact beverage product.\nPRODUCT: " + JSON.stringify(identity) +
    "\nFACTS WANTED (use exactly these field names): " + wanted.join(", ") +
    "\nSearch the web for the exact brand and product expression. Prefer the producer's own site, then regulators and reputable references; retailers are fine as support. " +
    "Return only facts a search result states for this exact product (not a sibling expression, size or age). Leave out anything you cannot find. " +
    "For every fact give a 0-1 confidence and list the search-result URLs that support it (use field names in supports). Call bottle_enrichment once." }];
  const all: Array<Record<string, unknown>> = [];
  let input: Record<string, unknown> = {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    for (let turn = 0; turn < 3; turn++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: controller.signal,
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 3000,
          system: "You are a careful beverage product researcher for a drinks catalogue. Search first, then report only facts the search results support for the exact product. Never guess or fill from memory.",
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: RESEARCH_SEARCHES }, ENRICHMENT_TOOL],
          tool_choice: { type: "auto" }, messages }),
      });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error("research_http_" + r.status);
      const blocks = Array.isArray(p.content) ? p.content as Array<Record<string, unknown>> : [];
      all.push(...blocks);
      const tool = blocks.find((b) => b.type === "tool_use" && b.name === "bottle_enrichment");
      if (tool && tool.input && typeof tool.input === "object") { input = tool.input as Record<string, unknown>; break; }
      if (p.stop_reason !== "pause_turn" || turn === 2) break;
      messages.push({ role: "assistant", content: blocks });
    }
  } finally { clearTimeout(timer); }
  const found = new Map<string, string>();
  for (const b of all) {
    if (b.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue;
    for (const row of b.content as Array<Record<string, unknown>>) { const u = normalizeUrl(row.url); if (u) found.set(u, clean(row.title, 180)); }
  }
  const allowed = new Set(wanted);
  const sources: Array<{ url: string; title: string; supports: string[]; kind: string }> = [];
  const supported = new Set<string>();
  for (const s of (Array.isArray(input.sources) ? input.sources : []).slice(0, 8) as Array<Record<string, unknown>>) {
    const u = normalizeUrl(s.url);
    if (!u || !found.has(u) || sources.some((x) => x.url === u)) continue;   // only URLs the search really returned
    const supports = [...new Set((Array.isArray(s.supports) ? s.supports : []).map((x) => String(x).trim()).filter((x) => allowed.has(x)))];
    if (!supports.length) continue;
    supports.forEach((f) => supported.add(f));
    sources.push({ url: u, title: found.get(u) || clean(s.title, 180), supports, kind: String(s.source_type || "reference") });
  }
  const rawFields = (input.fields && typeof input.fields === "object" ? input.fields : {}) as Record<string, unknown>;
  const rawScores = (input.field_confidence && typeof input.field_confidence === "object" ? input.field_confidence : {}) as Record<string, unknown>;
  const facts: Record<string, { value: string; confidence: number }> = {};
  for (const [field, value] of Object.entries(rawFields)) {
    const v = clean(value, 240), c = unit(rawScores[field]);
    if (allowed.has(field) && supported.has(field) && v && c >= 0.75) facts[field] = { value: v, confidence: c };
  }
  return { facts, sources: sources.filter((s) => s.supports.some((f) => facts[f])), searchResults: found.size };
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
    const wanted = (FIELDS_BY_CATEGORY[b.category] ?? COMMON).filter((f) => !have.has(f) && !clean(b.details[f], 80));
    if (!wanted.length) return await finish({ result: "no_missing_research_fields", by: "live-autosave" });
    const { data: budgetOk, error: budgetError } = await db.rpc("discover_reserve_bottle_research_budget", {
      p_consumer: subject, p_jobs: 1, p_search_units: RESEARCH_SEARCHES,
      p_user_jobs_max: 30, p_project_jobs_max: 200, p_user_search_max: 90, p_project_search_max: 600,
    });
    if (budgetError || budgetOk !== true) return await finish({ result: "research_budget_exhausted", by: "live-autosave" }, "retry");
    const model = Deno.env.get("DISCOVER_RESEARCH_MODEL") || Deno.env.get("DISCOVER_BOTTLE_MODEL") || "claude-haiku-5-5";
    const identity = { brand: b.brand, product: b.product, category: b.category, proof: b.proof || undefined, size: b.size || undefined };
    const result = await research(apiKey, model, identity, wanted);
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
    const canResearch = !!(productId && apiKey && researchBottle.product);
    if (canResearch) researchTasks.push(researchProduct(db, apiKey, subject, productId!, String(inserted.id), researchBottle));
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
