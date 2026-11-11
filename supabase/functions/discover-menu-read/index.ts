// Recovered canonical source for deployed Discover DEV discover-menu-read v3.
// Reconstructed from the live deployed source on 10 Nov 2026 because the original source
// file was absent from the repository tree. Behavior is preserved except for explicit
// origin allow-listing, bounded JSON input, and an independent per-user AI-call limiter.
// Review against the deployment artifact before replacing the deployed function.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PROJECT = "lqqmwqrffelgnbngrkep";
const MODEL = Deno.env.get("DISCOVER_MENU_MODEL") || "claude-haiku-4-5";
const TYPES = ["cocktail", "beer", "wine", "spirit", "seltzer_cider", "non_alcoholic", "food", "other"];
const MAX_BODY_BYTES = 2048;
const CORS_HEADERS = "authorization,apikey,content-type";
const CORS_METHODS = "POST,OPTIONS";

function allowedOrigins(): Set<string> {
  return new Set((Deno.env.get("DISCOVER_ALLOWED_ORIGINS") ?? "")
    .split(",").map((v) => v.trim()).filter(Boolean).map((v) => {
      try { const u = new URL(v); return u.origin === v ? u.origin : ""; } catch { return ""; }
    }).filter(Boolean));
}
function originAllowed(origin: string | null): boolean {
  return !origin || allowedOrigins().has(origin);
}
function headers(origin: string | null): Headers {
  const h = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", vary: "Origin" });
  if (origin && originAllowed(origin)) {
    h.set("access-control-allow-origin", origin);
    h.set("access-control-allow-headers", CORS_HEADERS);
    h.set("access-control-allow-methods", CORS_METHODS);
    h.set("access-control-max-age", "600");
  }
  return h;
}
const reply = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), { status, headers: headers(origin) });
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

const TOOL = {
  name: "menu_items",
  description: "Transcribe orderable items printed on this menu page",
  input_schema: {
    type: "object", required: ["legible", "items"],
    properties: {
      legible: { type: "boolean" }, menu_title: { type: "string" },
      items: { type: "array", maxItems: 150, items: { type: "object", required: ["name", "type"], properties: {
        section: { type: "string" }, name: { type: "string" }, price: { type: "string" },
        description: { type: "string" }, type: { type: "string", enum: TYPES },
        brands: { type: "array", items: { type: "string" } },
      } } },
    },
  },
};
const SYSTEM = "Transcribe only what is visibly printed on this menu page. Return one entry per orderable item. Copy name, section, price, and description exactly. Include brands only when explicitly printed. Never guess, correct, translate, or complete missing text. Ignore decorative text and addresses. If unreadable, set legible=false. Always call menu_items.";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!originAllowed(origin)) return reply({ error: "origin_not_allowed" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405, origin);

  const url = Deno.env.get("SUPABASE_URL") || "";
  try {
    if (new URL(url).hostname !== PROJECT + ".supabase.co") return reply({ error: "environment_refused" }, 503, origin);
  } catch { return reply({ error: "environment_refused" }, 503, origin); }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!serviceKey || !anthropicKey) return reply({ error: "discover_menu_configuration_missing" }, 503, origin);

  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  if (!bearer) return reply({ error: "unauthorized" }, 401, origin);
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await db.auth.getUser(bearer);
  if (authError || !auth?.user) return reply({ error: "unauthorized" }, 401, origin);

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) return reply({ error: "content_type_must_be_json" }, 415, origin);
  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (declaredLength > MAX_BODY_BYTES) return reply({ error: "payload_too_large" }, 413, origin);
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return reply({ error: "payload_too_large" }, 413, origin);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        Object.keys(parsed).length !== 1 || typeof parsed.observation_id !== "string") {
      return reply({ error: "invalid_request" }, 400, origin);
    }
    body = parsed as Record<string, unknown>;
  } catch { return reply({ error: "invalid_json" }, 400, origin); }

  const id = body.observation_id as string;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return reply({ error: "invalid_observation_id" }, 400, origin);
  const subject = auth.user.id;
  const { data: observation } = await db.from("menu_observations")
    .select("id,consumer_id,status").eq("id", id).eq("consumer_id", subject).maybeSingle();
  if (!observation) return reply({ error: "observation_not_found" }, 404, origin);

  // Independent server-side limiter: this function is directly addressable, so the
  // outer discover-api observation limiter is not sufficient protection by itself.
  // The database function is SECURITY DEFINER and service-role-only.
  const { data: rateAllowed, error: rateError } = await db.rpc("discover_rate_limit", {
    p_subject: subject, p_bucket: "menu_read", p_max: 10, p_window_seconds: 60,
  });
  if (rateError || rateAllowed !== true) {
    return reply({ error: rateError ? "rate_limit_unavailable" : "rate_limited" }, rateError ? 503 : 429, origin);
  }

  const { data: assets, count: assetCount, error: assetsError } = await db.from("observation_assets")
    .select("id,object_path,mime_type,byte_size,sha256,processing_status", { count: "exact" })
    .eq("observation_id", id).eq("consumer_id", subject).is("deleted_at", null)
    .order("created_at", { ascending: true }).limit(12);
  if (assetsError || !assets?.length) return reply({ error: "no_assets" }, 409, origin);
  if ((assetCount ?? assets.length) > 12) {
    await db.from("menu_observations").update({
      all_pages_complete: false, structured_menu_saved: false, status: "processing",
    }).eq("id", id).eq("consumer_id", subject);
    return reply({ error: "page_limit_exceeded", max_pages: 12 }, 413, origin);
  }

  let pages = 0, itemsSaved = 0, skipped = 0;
  const failures: Array<Record<string, unknown>> = [];
  for (const [page, asset] of assets.entries()) {
    if (asset.byte_size > 15 * 1024 * 1024) { failures.push({ page, error: "image_too_large" }); continue; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(asset.mime_type)) { failures.push({ page, error: "unsupported_image_type" }); continue; }
    const { data: prior } = await db.from("observation_extractions")
      .select("id,extraction_status").eq("asset_id", asset.id).maybeSingle();
    if (prior?.extraction_status === "extracted") { skipped++; pages++; continue; }
    const { data: signed, error: signError } = await db.storage.from("observation-assets").createSignedUrl(asset.object_path, 600);
    if (signError || !signed?.signedUrl) { failures.push({ page, error: "image_sign_failed" }); continue; }

    // Bound actual model calls as well as HTTP requests: one request may contain up to 12 pages.
    const { data: pageAllowed, error: pageRateError } = await db.rpc("discover_rate_limit", {
      p_subject: subject, p_bucket: "menu_read_page", p_max: 20, p_window_seconds: 60,
    });
    if (pageRateError || pageAllowed !== true) {
      failures.push({ page, error: pageRateError ? "page_rate_limit_unavailable" : "page_rate_limited" });
      break;
    }

    let response: Response, rawProvider: Record<string, unknown>;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 6000, system: SYSTEM, tools: [TOOL],
          tool_choice: { type: "tool", name: "menu_items" },
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "url", url: signed.signedUrl } },
            { type: "text", text: "Transcribe this menu page." },
          ] }],
        }),
      });
      rawProvider = await response.json();
    } catch { failures.push({ page, error: "vision_network_failed" }); continue; }
    if (!response.ok) { failures.push({ page, error: "vision_provider_error", status: response.status }); continue; }

    const content = Array.isArray(rawProvider.content) ? rawProvider.content as Array<Record<string, unknown>> : [];
    const read = content.find(x => x.type === "tool_use" && x.name === "menu_items")?.input as Record<string, unknown> | undefined;
    if (!read || typeof read.legible !== "boolean" || !Array.isArray(read.items)) {
      failures.push({ page, error: "invalid_vision_response" });
      continue;
    }
    // A page the model explicitly marks unreadable is not a completed page.
    // Do not save an extraction or let another page's items make this scan eligible.
    if (read.legible !== true) {
      failures.push({ page, error: "page_unreadable" });
      continue;
    }
    const inputItems = read.items.slice(0, 150) as Array<Record<string, unknown>>;
    const items = inputItems.map((x, i) => ({
      observation_id: id, consumer_id: subject, page_index: page, position: i,
      section: clean(x.section, 80) || null, name: clean(x.name, 200),
      description: clean(x.description, 600) || null, price_text: clean(x.price, 40) || null,
      beverage_category: ({ spirit: "spirits", seltzer_cider: "other", non_alcoholic: "non_alcoholic", food: "food" } as Record<string, string>)[String(x.type)] ||
        (["cocktail", "beer", "wine"].includes(String(x.type)) ? String(x.type) : "other"),
      listed_ingredients: [], evidence_state: "menu_observed", text_verified: false,
    })).filter(x => x.name);

    const { error: deleteError } = await db.from("observation_items").delete()
      .eq("observation_id", id).eq("consumer_id", subject).eq("page_index", page);
    if (deleteError) { failures.push({ page, error: "item_refresh_failed" }); continue; }
    if (items.length) {
      const { error: insertError } = await db.from("observation_items").insert(items);
      if (insertError) { failures.push({ page, error: "item_save_failed" }); continue; }
    }
    const extraction = {
      observation_id: id, asset_id: asset.id, extraction_status: "extracted", sha256: asset.sha256,
      ocr_provider: "phg_vision_discover_copy",
      ocr_payload: { model: MODEL, legible: !!read.legible, menu_title: clean(read.menu_title, 120), items: inputItems, usage: rawProvider.usage || null },
    };
    const { error: saveError } = await db.from("observation_extractions").upsert(extraction, { onConflict: "asset_id" });
    if (saveError) { failures.push({ page, error: "extraction_save_failed" }); continue; }
    await db.from("observation_assets").update({ processing_status: "processed" }).eq("id", asset.id).eq("consumer_id", subject);
    pages++; itemsSaved += items.length;
  }

  const complete = failures.length === 0 && pages === assets.length;
  const { count: structuredItemCount, error: countError } = await db.from("observation_items")
    .select("id", { count: "exact", head: true }).eq("observation_id", id).eq("consumer_id", subject);
  if (countError) failures.push({ error: "structured_item_count_failed" });
  const allPagesComplete = complete && failures.length === 0;
  await db.from("menu_observations").update({
    read_model: MODEL, read_at: new Date().toISOString(),
    all_pages_complete: allPagesComplete,
    structured_menu_saved: allPagesComplete && (structuredItemCount ?? 0) > 0,
    ...(allPagesComplete ? { status: "ready_for_review" } : { status: "processing" }),
  }).eq("id", id).eq("consumer_id", subject);
  return reply({ ok: complete, observation_id: id, pages_read: pages, items_saved: itemsSaved,
    pages_skipped_as_already_read: skipped, failures }, complete ? 200 : 207, origin);
});
