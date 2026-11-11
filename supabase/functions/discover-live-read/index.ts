// Harmony Discover DEV — discover-live-read v0.3.0 (11 Nov 2026).
// One live scanner for everything: one camera frame in; every bottle label on it and, if a menu is in view, its items out.
// - frame: Claude reads ONLY what is printed on each label, returns a box per bottle; each read is then
//          matched to public.product_index by text (discover_match_products). No image is stored.
// - save:  the bottles the person kept become rows in public.bottle_sightings (the shared sightings ledger).
// Guards: signed-in Discover user (anonymous users included), exact-origin allow-list, DEV project only,
// 30 frames/minute per user, plus a per-user and a whole-project daily frame cap with token logging.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const VERSION = "0.3.0";
const PROJECT = "lqqmwqrffelgnbngrkep";
const MODEL = Deno.env.get("DISCOVER_BOTTLE_MODEL") || "claude-haiku-5-5";
const FALLBACK = "claude-haiku-4-5";
const USER_FRAMES_PER_DAY = 400, PROJECT_FRAMES_PER_DAY = 5000;
const MAX_BODY_BYTES = 450_000, MAX_SAVE = 60;
const MIN_LABEL_CONFIDENCE = 0.65;
const CATEGORIES = ["tequila", "mezcal", "whiskey", "vodka", "gin", "rum", "brandy", "liqueur", "amaro_aperitivo", "vermouth", "wine", "sparkling", "beer", "cider", "non_alcoholic", "other"];
// Everything else a label can carry. Each is copied only when printed; which ones matter depends on the bottle:
// wine (producer, vintage, appellation, grapes, classification), spirits (age, cask finish, batch, flavour), any (certifications).
const DETAILS: Record<string, string> = {
  producer: "producer, winery, distillery or bottler named on the label",
  vintage: "vintage or release year printed (four digits)",
  region: "region as printed (e.g. Napa Valley, Islay, Jalisco, Kentucky)",
  appellation: "appellation or protected name as printed (e.g. Barolo DOCG, Pauillac, Tequila 100% de Agave)",
  country: "country of origin as printed",
  grapes: "grape varieties as printed",
  classification: "class or quality tier as printed (e.g. Reposado, Añejo, Riserva, Grand Cru, Straight Bourbon, Bottled-in-Bond, Single Malt)",
  age_statement: "age statement as printed (e.g. 12 Years Old)",
  cask_finish: "cask or oak finish as printed (e.g. Sherry Cask, Port Finish, French Oak, New Charred Oak)",
  flavor: "flavour as printed for flavoured products (e.g. Peach, Vanilla)",
  batch: "batch, barrel or bottle number as printed",
  importer: "importer as printed",
};
const DETAIL_KEYS = Object.keys(DETAILS);
const SITE_ORIGIN = /^https:\/\/([a-z0-9-]+--)?harmony-discover\.netlify\.app$/;

function originAllowed(origin: string | null): boolean {
  if (!origin) return true;
  if (SITE_ORIGIN.test(origin)) return true;
  return (Deno.env.get("DISCOVER_ALLOWED_ORIGINS") ?? "").split(",").map((v) => v.trim()).includes(origin);
}
function headers(origin: string | null): Headers {
  const h = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", vary: "Origin" });
  if (origin && originAllowed(origin)) {
    h.set("access-control-allow-origin", origin);
    h.set("access-control-allow-headers", "authorization,apikey,content-type");
    h.set("access-control-allow-methods", "POST,OPTIONS");
    h.set("access-control-max-age", "600");
  }
  return h;
}
const reply = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: headers(origin) });
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const unit = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; };

function pickDetails(b: Record<string, unknown>): Record<string, unknown> {
  const src = (b.details && typeof b.details === "object" ? b.details : b) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of DETAIL_KEYS) { const v = clean(src[k], 80); if (v) out[k] = v; }
  const certs = (Array.isArray(src.certifications) ? src.certifications : []).map((c) => clean(c, 40)).filter(Boolean).slice(0, 6);
  if (certs.length) out.certifications = certs;
  return out;
}

const TOOL = {
  name: "bottles",
  description: "Every bottle whose label can be seen in this photo.",
  input_schema: {
    type: "object", required: ["bottles"],
    properties: {
      menu: { type: "object", required: ["visible"], description: "a printed drinks or food menu, if one is in view", properties: {
        visible: { type: "boolean" }, title: { type: "string" },
        items: { type: "array", maxItems: 40, items: { type: "object", required: ["name"], properties: {
          name: { type: "string", description: "item name exactly as printed" }, price: { type: "string", description: "price exactly as printed; empty if none" },
          type: { type: "string", enum: ["cocktail", "beer", "wine", "spirit", "non_alcoholic", "food", "other"] } } } } } },
      bottles: { type: "array", maxItems: 12, items: { type: "object", required: ["box", "confidence"], properties: {
      box: { type: "object", required: ["x0", "y0", "x1", "y1"], description: "the whole bottle, as fractions of image width and height (0 to 1); x0,y0 top-left, x1,y1 bottom-right",
        properties: { x0: { type: "number" }, y0: { type: "number" }, x1: { type: "number" }, y1: { type: "number" } } },
      label_words: { type: "array", maxItems: 8, items: { type: "string" }, description: "the main words printed on the label, largest first, exactly as printed" },
      brand: { type: "string", description: "brand name exactly as printed on the label; empty if it cannot be read" },
      product: { type: "string", description: "expression or product name as printed (e.g. Blanco, Reposado, Single Barrel); empty if none" },
      category: { type: "string", enum: CATEGORIES },
      proof: { type: "string", description: "strength exactly as printed (e.g. 40% ALC/VOL or 80 PROOF); empty if not readable" },
      size: { type: "string", description: "bottle size as printed; empty if not readable" },
      origin: { type: "string", description: "place of origin as printed; empty if not readable" },
      certifications: { type: "array", maxItems: 6, items: { type: "string" }, description: "certification marks or claims printed (e.g. USDA Organic, Kosher, Biodynamic, Vegan, Gluten Free, Additive Free)" },
      ...Object.fromEntries(DETAIL_KEYS.map((k) => [k, { type: "string", description: DETAILS[k] + "; empty if not printed or not readable" }])),
      confidence: { type: "number", description: "0 to 1: how sure you are the brand was READ from the label, not guessed" },
    } } } },
  },
};
const SYSTEM = "You read one photo taken in a bar, shop or restaurant: bottle labels (beer, wine, spirits, anything) and printed menus. If a printed menu is in view set menu.visible true and copy each legible item name and price exactly as printed, in order, inventing nothing; otherwise set menu.visible false. For each bottle with a visible label return its box and ONLY what is printed on that label. Never identify a bottle from its shape, colour or cap alone: if the brand text is not legible, leave brand empty and set confidence below 0.4. Do not invent, complete or correct label text. Skip glasses, taps, people and bottles facing away. Wine, spirits, beer and liqueurs carry different facts: copy the producer, vintage, region, appellation, grapes, class, age, cask finish, flavour, batch and any certification marks when they are printed, and leave every field that is not printed empty. If no labelled bottle is visible return an empty bottles list. Always call the bottles tool.";

async function readFrame(key: string, model: string, b64: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 4000, system: SYSTEM, tools: [TOOL], tool_choice: { type: "tool", name: "bottles" },
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }, { type: "text", text: "Read the bottle labels and any menu." }] }] }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!originAllowed(origin)) return reply({ error: "origin_not_allowed" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405, origin);

  const url = Deno.env.get("SUPABASE_URL") || "";
  try { if (new URL(url).hostname !== PROJECT + ".supabase.co") return reply({ error: "environment_refused" }, 503, origin); }
  catch { return reply({ error: "environment_refused" }, 503, origin); }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!serviceKey || !anthropicKey) return reply({ error: "discover_bottle_configuration_missing" }, 503, origin);

  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return reply({ error: "unauthorized" }, 401, origin);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await db.auth.getUser(bearer);
  if (authError || !auth?.user) return reply({ error: "unauthorized" }, 401, origin);
  const subject = auth.user.id;

  if (Number(req.headers.get("content-length") || "0") > MAX_BODY_BYTES) return reply({ error: "payload_too_large" }, 413, origin);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return reply({ error: "payload_too_large" }, 413, origin);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); }
  catch { return reply({ error: "invalid_json" }, 400, origin); }
  const action = String(body.action || "");
  if (action === "health") return reply({ ok: true, version: VERSION, model: MODEL }, 200, origin);

  const match = async (queries: string[]) => {
    const { data } = await db.rpc("discover_match_products", { p_queries: queries });
    return (Array.isArray(data) ? data : []) as Array<{ q: string; id: string | null; brand: string | null; product: string | null; category: string | null; proof: number | null; score: number | null }>;
  };

  if (action === "frame") {
    const image = String(body.image || "").replace(/^data:image\/jpeg;base64,/, "");
    if (image.length < 2000 || !/^[A-Za-z0-9+/=]+$/.test(image) || !image.startsWith("/9j/")) return reply({ error: "jpeg_frame_required" }, 400, origin);
    const { data: minuteOk, error: minuteErr } = await db.rpc("discover_rate_limit", { p_subject: subject, p_bucket: "bottle_frame", p_max: 30, p_window_seconds: 60 });
    if (minuteErr || minuteOk !== true) return reply({ error: minuteErr ? "rate_limit_unavailable" : "rate_limited" }, minuteErr ? 503 : 429, origin);
    const { data: dayOk, error: dayErr } = await db.rpc("discover_bottle_scan_allow", { p_subject: subject, p_user_max: USER_FRAMES_PER_DAY, p_global_max: PROJECT_FRAMES_PER_DAY });
    if (dayErr || dayOk !== true) return reply({ error: dayErr ? "daily_limit_unavailable" : "daily_limit_reached" }, dayErr ? 503 : 429, origin);

    let model = MODEL, r = await readFrame(anthropicKey, model, image);
    if (!r.ok && (r.status === 404 || (r.status === 400 && /model/i.test(String(r.j?.error?.message))))) { model = FALLBACK; r = await readFrame(anthropicKey, model, image); }
    const usage = r.j?.usage || {};
    await db.rpc("discover_bottle_scan_tokens", { p_subject: subject, p_in: usage.input_tokens || 0, p_out: usage.output_tokens || 0 });
    if (!r.ok) { console.log(JSON.stringify({ evt: "bottle_read_error", status: r.status, msg: clean(r.j?.error?.message, 160) })); return reply({ error: "vision_provider_error" }, 502, origin); }
    const input = (Array.isArray(r.j?.content) ? r.j.content : []).find((c: Record<string, unknown>) => c.type === "tool_use" && c.name === "bottles")?.input as Record<string, unknown> | undefined;
    const list = (Array.isArray(input?.bottles) ? input!.bottles as Array<Record<string, unknown>> : []).slice(0, 12).map((b) => {
      const bx = (b.box || {}) as Record<string, unknown>;
      return {
        box: { x0: unit(bx.x0), y0: unit(bx.y0), x1: unit(bx.x1), y1: unit(bx.y1) },
        words: (Array.isArray(b.label_words) ? b.label_words : []).map((w) => clean(w, 40)).filter(Boolean).slice(0, 8),
        brand: clean(b.brand, 80), product: clean(b.product, 80),
        category: CATEGORIES.includes(String(b.category)) ? String(b.category) : "other",
        proof: clean(b.proof, 30), size: clean(b.size, 30), origin: clean(b.origin, 60), confidence: unit(b.confidence),
        details: pickDetails(b),
      };
    }).filter((b) => b.box.x1 > b.box.x0 && b.box.y1 > b.box.y0);
    const queries = list.map((b) => clean(`${b.brand} ${b.product}`, 120) || b.words.slice(0, 3).join(" "));
    const found = queries.length ? await match(queries) : [];
    const bottles = list.map((b, i) => {
      const m = found.find((f) => f.q === queries[i]);
      const hit = m?.id && (m.score ?? 0) >= 0.6 ? { id: m.id, brand: m.brand, product: m.product, score: Math.round((m.score ?? 0) * 100) / 100 } : null;
      const state = !b.brand || b.confidence < MIN_LABEL_CONFIDENCE ? "unsure" : hit ? "matched" : "reported";
      return { ...b, match: hit, state };
    });
    const mraw = (input?.menu && typeof input.menu === "object" ? input.menu : {}) as Record<string, unknown>;
    const items = (Array.isArray(mraw.items) ? mraw.items as Array<Record<string, unknown>> : []).slice(0, 40)
      .map((x) => ({ name: clean(x.name, 120), price: clean(x.price, 30), type: clean(x.type, 20) || "other" })).filter((x) => x.name);
    const menu = { visible: mraw.visible === true && items.length > 0, title: clean(mraw.title, 80), items };
    return reply({ ok: true, version: VERSION, model, bottles, menu }, 200, origin);
  }

  if (action === "save") {
    const session = String(body.scan_session_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session)) return reply({ error: "scan_session_id_required" }, 400, origin);
    const { data: saveOk, error: saveErr } = await db.rpc("discover_rate_limit", { p_subject: subject, p_bucket: "bottle_save", p_max: 6, p_window_seconds: 60 });
    if (saveErr || saveOk !== true) return reply({ error: saveErr ? "rate_limit_unavailable" : "rate_limited" }, saveErr ? 503 : 429, origin);
    const incoming = (Array.isArray(body.bottles) ? body.bottles as Array<Record<string, unknown>> : []).slice(0, MAX_SAVE)
      .map((b) => ({ brand: clean(b.brand, 80), product: clean(b.product, 80), category: CATEGORIES.includes(String(b.category)) ? String(b.category) : "other",
        proof: clean(b.proof, 30), size: clean(b.size, 30), words: (Array.isArray(b.words) ? b.words : []).map((w) => clean(w, 40)).filter(Boolean).slice(0, 8), confidence: unit(b.confidence), details: pickDetails(b) }))
      .filter((b) => b.brand && b.confidence >= MIN_LABEL_CONFIDENCE);
    if (!incoming.length) return reply({ error: "no_bottles" }, 400, origin);
    const queries = incoming.map((b) => clean(`${b.brand} ${b.product}`, 120));
    const found = await match(queries);   // matched again on the server; the browser's ids are never trusted
    const venue = clean(body.venue_name, 120) || null;
    const rows = incoming.map((b, i) => {
      const m = found.find((f) => f.q === queries[i]); const hit = m?.id && (m.score ?? 0) >= 0.6;
      return { consumer_id: subject, scan_session_id: session, venue_name_submitted: venue, product_index_id: hit ? m!.id : null, match_score: hit ? m!.score : null,
        read_brand: b.brand, read_product: b.product || null, read_category: b.category, read_proof: b.proof || null, read_size: b.size || null,
        label_text: b.words.join(" ") || null, read_vintage: /^(18|19|20)\d{2}$/.test(String(b.details.vintage || "")) ? Number(b.details.vintage) : null, label_details: b.details, read_confidence: b.confidence, method: "vision_frame", evidence_state: "reported",
        reader: "discover-live-read", reader_version: VERSION, read_model: MODEL };
    });
    const { error } = await db.from("bottle_sightings").insert(rows);
    if (error) { console.log(JSON.stringify({ evt: "bottle_save_error", msg: clean(error.message, 160) })); return reply({ error: "save_failed" }, 503, origin); }
    return reply({ ok: true, saved: rows.length, matched: rows.filter((x) => x.product_index_id).length }, 200, origin);
  }
  return reply({ error: "unknown_action" }, 400, origin);
});
