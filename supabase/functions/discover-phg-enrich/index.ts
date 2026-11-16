// discover-phg-enrich v0.1 — Steps 3-4 for PHG "unknown" products that COLA could not fill.
// Reads the product's own web page (free), then lets Harmony's reasoning model (Claude) confirm/fill facts with a
// small number of web searches. Results are STAGED in Discover DEV (discover_phg_enrich_queue). No PHG writes.
// Auth: x-discover-cron-secret (checked by discover_check_cron_secret). Key: ANTHROPIC_API_KEY (never logged).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const VERSION = "0.1";
const PROJECT = "lqqmwqrffelgnbngrkep";
const MAX_PER_CALL = 6;
const PARALLEL = 3;
const SEARCHES = 3;
const PAGE_CHARS = 7000;
const TIME_BUDGET_MS = 100_000;
// Price per million tokens (input, output) and per search. Used only for the spend record.
const PRICE_IN = 0.10, PRICE_OUT = 0.50, PRICE_SEARCH = 0.01;

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const clean = (v: unknown, n = 300) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const TOOL = {
  name: "product_facts",
  description: "Report facts about the exact product.",
  input_schema: { type: "object", required: ["matched_exact_product", "fields", "field_confidence", "sources"], properties: {
    matched_exact_product: { type: "boolean", description: "true only if the page or search results clearly describe this exact product" },
    fields: { type: "object", properties: {
      abv_percent: { type: "number" }, size_ml: { type: "number" }, age_years: { type: "number" },
      category: { type: "string", description: "plain style, e.g. 'Kentucky straight bourbon', 'tawny port', 'flavoured vodka', 'cocktail syrup'" },
      country: { type: "string" }, region: { type: "string" }, producer: { type: "string" },
      release_year: { type: "number" }, limited_edition: { type: "boolean" },
      description: { type: "string", description: "own words, at most 40 words" },
      tasting_notes: { type: "string", description: "own words, at most 35 words" },
      upc: { type: "string" },
    } },
    field_confidence: { type: "object", additionalProperties: { type: "number" } },
    sources: { type: "array", maxItems: 6, items: { type: "object", required: ["url", "supports"], properties: {
      url: { type: "string" }, supports: { type: "array", items: { type: "string" } } } } },
  } },
};

function pageText(html: string, words: string[]) {
  const ld: string[] = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const t = m[1].replace(/\s+/g, " ").trim();
    if (words.some((w) => norm(t).includes(w))) ld.push(t.slice(0, 2500));
  }
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  // Keep the parts of the page that mention the product (listing pages show many bottles).
  const chunks = text.match(/.{1,400}(\s|$)/g) ?? [];
  const scored = chunks.map((c, i) => ({ i, c, s: words.filter((w) => norm(c).includes(w)).length }));
  const best = scored.filter((x) => x.s >= Math.max(1, Math.ceil(words.length / 2))).sort((a, b) => b.s - a.s).slice(0, 10)
    .map((x) => x.i).sort((a, b) => a - b);
  const keep = new Set<number>(); for (const i of best) { keep.add(i - 1); keep.add(i); keep.add(i + 1); }
  let out = [...keep].filter((i) => i >= 0 && i < chunks.length).sort((a, b) => a - b).map((i) => chunks[i]).join(" … ");
  if (!out) out = text.slice(0, 2000);
  return (ld.length ? "STRUCTURED DATA: " + ld.join(" | ") + "\nPAGE TEXT: " : "PAGE TEXT: ") + out.slice(0, PAGE_CHARS);
}

async function fetchPage(url: string, words: string[]) {
  if (!/^https?:\/\//.test(url ?? "")) return { status: 0, text: "" };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12_000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: {
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "accept": "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" } });
    if (!r.ok) { await r.body?.cancel(); return { status: r.status, text: "" }; }
    const html = (await r.text()).slice(0, 1_500_000);
    return { status: r.status, text: pageText(html, words) };
  } catch { return { status: -1, text: "" }; } finally { clearTimeout(t); }
}

async function research(apiKey: string, model: string, item: Record<string, any>, page: string) {
  const identity = { brand: item.brand, product: item.product_name, known_size_ml: item.known_size_ml ?? undefined, known_abv: item.known_abv ?? undefined };
  const prompt = "Find facts for this exact beverage product.\nPRODUCT: " + JSON.stringify(identity) +
    (page ? "\nThe catalogue found it on this page (it may list many bottles; use only what is about this exact product):\nURL: " + item.url + "\n" + page
          : "\nIts catalogue page could not be read.") +
    "\nIf the page already states a fact clearly, use it without searching. Otherwise search the web (producer's site first, then regulators, reputable references; retailers are fine as support). " +
    "Report only facts stated for this exact product, not a sibling expression, size or age. Leave out what you cannot find. " +
    "description and tasting_notes: your own words, never copied sentences. Give each field a 0-1 confidence and list supporting URLs (field names in supports; use the page URL above when the page is the source). Call product_facts once.";
  const messages: any[] = [{ role: "user", content: prompt }];
  let input: any = {}, inTok = 0, outTok = 0, searches = 0, note = "";
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 75_000);
  try {
    for (let turn = 0; turn < 3; turn++) {
      const last = turn === 2;
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: ctl.signal,
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 1500,
          system: "You are Harmony's careful drinks researcher. Report only facts the page or search results support for the exact product. Never guess or fill from memory.",
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: SEARCHES }, TOOL],
          tool_choice: last ? { type: "tool", name: "product_facts" } : { type: "any" }, messages }) });
      const p: any = await r.json().catch(() => ({}));
      if (!r.ok) { note = "http_" + r.status + " " + clean(p?.error?.message, 100); break; }
      inTok += Number(p?.usage?.input_tokens ?? 0) + Number(p?.usage?.cache_read_input_tokens ?? 0) + Number(p?.usage?.cache_creation_input_tokens ?? 0);
      outTok += Number(p?.usage?.output_tokens ?? 0);
      searches += Number(p?.usage?.server_tool_use?.web_search_requests ?? 0);
      const blocks = Array.isArray(p.content) ? p.content : [];
      const tool = blocks.find((b: any) => b.type === "tool_use" && b.name === "product_facts");
      if (tool?.input) { input = tool.input; break; }
      messages.push({ role: "assistant", content: blocks.filter((b: any) => b.type !== "thinking" && b.type !== "redacted_thinking") });
      if (p.stop_reason !== "pause_turn") messages.push({ role: "user", content: "Now call product_facts with what the page and search results support." });
    }
  } catch (e) { note = "error " + clean((e as Error)?.message, 80); } finally { clearTimeout(timer); }
  for (const k of ["fields", "field_confidence", "sources"]) if (typeof input[k] === "string") { try { input[k] = JSON.parse(input[k]); } catch { /* */ } }
  return { input, inTok, outTok, searches, note };
}

function tidy(input: any, item: Record<string, any>) {
  const f = input?.fields ?? {}, c = input?.field_confidence ?? {};
  const out: Record<string, unknown> = {};
  const num = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined; };
  const put = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== "" && (c[k] ?? 0.7) >= 0.5) out[k] = v; };
  put("abv_percent", num(f.abv_percent, 0, 96)); put("size_ml", num(f.size_ml, 20, 20000)); put("age_years", num(f.age_years, 1, 80));
  put("release_year", num(f.release_year, 1800, 2030));
  for (const k of ["category", "country", "region", "producer"]) put(k, clean(f[k], 80) || undefined);
  for (const k of ["description", "tasting_notes"]) put(k, clean(f[k], 320) || undefined);
  if (typeof f.limited_edition === "boolean") put("limited_edition", f.limited_edition);
  const upc = String(f.upc ?? "").replace(/\D/g, ""); if (upc.length >= 8 && upc.length <= 14) put("upc", upc);
  return { matched_exact_product: input?.matched_exact_product === true, fields: out, field_confidence: c,
    sources: (Array.isArray(input?.sources) ? input.sources : []).slice(0, 6).map((s: any) => ({ url: clean(s?.url, 300), supports: (s?.supports ?? []).slice(0, 12) })),
    page_used: !!item._page };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "", serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  try { if (new URL(url).hostname !== PROJECT + ".supabase.co") return json({ error: "environment_refused" }, 503); } catch { return json({ error: "environment_refused" }, 503); }
  const supplied = req.headers.get("x-discover-cron-secret") ?? "";
  if (supplied.length < 32 || supplied.length > 512) return json({ error: "unauthorized" }, 401);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: ok } = await db.rpc("discover_check_cron_secret", { p_given: supplied });
  if (ok !== true) return json({ error: "unauthorized" }, 401);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!apiKey) return json({ error: "research_not_configured" }, 503);
  const model = Deno.env.get("DISCOVER_RESEARCH_MODEL") || Deno.env.get("DISCOVER_BOTTLE_MODEL") || "claude-haiku-5-5";
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const n = Math.min(Math.max(1, Number(body.limit ?? 3)), MAX_PER_CALL);
  const started = Date.now();
  const { data: items, error } = await db.rpc("discover_phg_enrich_claim", { p_n: n, p_batch: body.batch ?? null });
  if (error) return json({ error: "claim_failed" }, 500);
  const results: any[] = [];
  const queue = [...(items ?? [])];
  async function worker() {
    while (queue.length && Date.now() - started < TIME_BUDGET_MS) {
      const item: any = queue.shift();
      const words = [...new Set(norm(item.product_name).split(" ").filter((w) => w.length >= 3 && !["the", "and", "year", "old", "with"].includes(w)))].slice(0, 8);
      const pg = await fetchPage(item.url, words);
      item._page = pg.text;
      const r = await research(apiKey, model, item, pg.text);
      const cost = (r.inTok * PRICE_IN + r.outTok * PRICE_OUT) / 1e6 + r.searches * PRICE_SEARCH;
      const result = tidy(r.input, item);
      const failed = !Object.keys(r.input ?? {}).length;
      await db.from("discover_phg_enrich_queue").update({
        status: failed ? (item.attempts >= 2 ? "failed" : "pending") : "done",
        page_status: pg.status, page_chars: pg.text.length, result: failed ? null : result, error: r.note || null,
        searches: (item.searches ?? 0) + r.searches, input_tokens: (item.input_tokens ?? 0) + r.inTok, output_tokens: (item.output_tokens ?? 0) + r.outTok,
        cost_usd: Number(item.cost_usd ?? 0) + cost, finished_at: new Date().toISOString(),
      }).eq("phg_code", item.phg_code);
      results.push({ code: item.phg_code, page: pg.status, fields: Object.keys(result.fields).length, searches: r.searches, cost: Math.round(cost * 10000) / 10000, note: r.note || undefined });
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  console.log(JSON.stringify({ evt: "phg_enrich", version: VERSION, n: results.length }));
  return json({ ok: true, version: VERSION, model, processed: results.length, results });
});
