// Harmony Discover DEV — discover-verify-read v0.1.0 (Rob, 17 Nov 2026). Partial evidence, step 4.
// A bottle whose label is partly hidden or cut off may already have a leading name ("Probably Colonel E.H. Taylor
// Cured Oak") from the pieces its label reads saw. This asks one pointed question about one label crop: which of
// these (at most 3) names does the VISIBLE text belong to, if any? Claude only reads and chooses; the names come
// from the catalogue and the scan scene, and the app still decides when a bottle is confirmed. Nothing is stored.
// Guards: signed-in Discover user (anonymous included), exact-origin allow-list, DEV project only, 8 checks a minute
// per user, and each check counts toward the same daily scan caps as label reads (400 per user, 5,000 project).
// The answer is accepted only when the words the model says it can see back the chosen name.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { backing, pointsToAnother, type Candidate } from "./backing.ts";

const VERSION = "0.1.0";
const PROJECT = "lqqmwqrffelgnbngrkep";
const MODEL = Deno.env.get("DISCOVER_VERIFY_MODEL") || "claude-haiku-5-5";
const FALLBACK = "claude-haiku-5-5";
const USER_FRAMES_PER_DAY = 400, PROJECT_FRAMES_PER_DAY = 5000;
const CHECKS_PER_MINUTE = 8;
const MAX_BODY_BYTES = 130_000;
const MIN_CONFIDENCE = 0.6;
// Production, its deploy previews, and the test site.
const SITE_ORIGIN = /^https:\/\/([a-z0-9-]+--)?harmony-discover(-test)?\.netlify\.app$/;

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
const TOOL = {
  name: "label_check",
  description: "Which candidate name the visible text on this label belongs to.",
  input_schema: {
    type: "object", required: ["visible_words", "choice", "contradicting_words", "confidence"],
    properties: {
      visible_words: { type: "array", maxItems: 16, items: { type: "string" }, description: "Every word or part-word you can actually see printed, exactly as seen (a word cut off at an edge stays cut off)." },
      choice: { type: "integer", description: "Number of the candidate the visible text belongs to; 0 if it fits none, fits more than one, or cannot be told." },
      contradicting_words: { type: "array", maxItems: 6, items: { type: "string" }, description: "Visible words that belong to one of the OTHER candidates rather than the chosen one. Empty if none. (Words from another bottle in the photo do not count.)" },
      confidence: { type: "number", description: "0 to 1: how sure you are, from the visible text only." },
    },
  },
};
const SYSTEM = "You check one beverage label crop against a short list of candidate names. The label may be partly hidden behind another bottle or cut off at the edge of the photo; the crop may also show part of that other bottle, which is not the one being checked. Read only printed text you can actually see; never complete hidden words from memory and never choose from bottle shape or colour alone. Choose the candidate whose name the visible text belongs to. Choose 0 when the visible text fits none of them, fits more than one equally, or belongs to a different product. Always answer by calling the label_check tool once.";

async function check(key: string, model: string, image: string, candidates: Candidate[]) {
  const list = candidates.map((c, i) => `${i + 1}. ${c.brand}${c.product ? " — " + c.product : ""}`).join("\n");
  const adaptive = /sonnet-5|opus-5/.test(model);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 600, system: SYSTEM, tools: [TOOL],
      ...(adaptive ? { tool_choice: { type: "auto" }, output_config: { effort: "low" } } : { tool_choice: { type: "tool", name: "label_check" } }),
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
        { type: "text", text: "Candidates:\n" + list + "\n\nWhich one does the visible text belong to? 0 if none or unclear." },
      ] }],
    }),
  });
  const j = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, j };
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
  if (!serviceKey || !anthropicKey) return reply({ error: "discover_verify_configuration_missing" }, 503, origin);

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
  if (body.action === "health") return reply({ ok: true, version: VERSION, model: MODEL }, 200, origin);

  const image = String(body.image || "").replace(/^data:image\/jpeg;base64,/, "");
  if (image.length < 1200 || image.length > 110_000 || !/^[A-Za-z0-9+/=]+$/.test(image) || !image.startsWith("/9j/")) return reply({ error: "invalid_label_crop" }, 400, origin);
  const candidates = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 3)
    .map((c: Record<string, unknown>) => ({ brand: clean(c?.brand, 80), product: clean(c?.product, 100) }))
    .filter((c: Candidate) => c.brand);
  if (!candidates.length) return reply({ error: "candidates_required" }, 400, origin);

  const { data: minuteOk, error: minuteErr } = await db.rpc("discover_rate_limit", { p_subject: subject, p_bucket: "bottle_verify", p_max: CHECKS_PER_MINUTE, p_window_seconds: 60 });
  if (minuteErr || minuteOk !== true) return reply({ error: minuteErr ? "rate_limit_unavailable" : "rate_limited" }, minuteErr ? 503 : 429, origin);
  const { data: dayOk, error: dayErr } = await db.rpc("discover_bottle_scan_allow", { p_subject: subject, p_user_max: USER_FRAMES_PER_DAY, p_global_max: PROJECT_FRAMES_PER_DAY });
  if (dayErr || dayOk !== true) return reply({ error: dayErr ? "daily_limit_unavailable" : "daily_limit_reached" }, dayErr ? 503 : 429, origin);

  const startedAt = Date.now();
  let model = MODEL, r = await check(anthropicKey, model, image, candidates);
  if (!r.ok && model !== FALLBACK && (r.status === 404 || (r.status === 400 && /model/i.test(String(r.j?.error?.message))))) {
    model = FALLBACK; r = await check(anthropicKey, model, image, candidates);
  }
  const usage = r.j?.usage || {};
  await db.rpc("discover_bottle_scan_tokens", { p_subject: subject, p_in: usage.input_tokens || 0, p_out: usage.output_tokens || 0 });
  if (!r.ok) {
    console.log(JSON.stringify({ evt: "discover_verify_error", version: VERSION, status: r.status, msg: clean(r.j?.error?.message, 160) }));
    return reply({ error: "vision_provider_error" }, 502, origin);
  }
  const input = (Array.isArray(r.j?.content) ? r.j.content : []).find((c: Record<string, unknown>) => c.type === "tool_use" && c.name === "label_check")?.input as Record<string, unknown> | undefined;
  const visibleWords = (Array.isArray(input?.visible_words) ? input!.visible_words as unknown[] : []).map((w) => clean(w, 40)).filter(Boolean).slice(0, 16);
  const contradicting = (Array.isArray(input?.contradicting_words) ? input!.contradicting_words as unknown[] : []).map((w) => clean(w, 40)).filter(Boolean).slice(0, 6);
  const choice = Number.isInteger(Number(input?.choice)) ? Number(input?.choice) : 0;
  const confidence = Math.min(0.9, unit(input?.confidence));
  let verdict: "match" | "none" = "none", level: "product" | "brand" | "none" = "none", reason = "";
  if (choice < 1 || choice > candidates.length) reason = "no_choice";
  else if (confidence < MIN_CONFIDENCE) reason = "unsure";
  else {
    const chosen = candidates[choice - 1]!;
    const others = candidates.filter((_: Candidate, i: number) => i !== choice - 1);
    // Visible words that fit another candidate make it a tie, not a match.
    if (pointsToAnother(chosen, others, contradicting)) reason = "contradicted";
    else {
      level = backing(chosen, others, visibleWords);
      if (level === "none") reason = "not_backed_by_visible_words";
      else verdict = "match";
    }
  }
  const chosen = verdict === "match" ? candidates[choice - 1]! : null;
  // Diagnostics only: no image, no words, no names.
  console.log(JSON.stringify({ evt: "discover_verify_result", version: VERSION, model, provider_ms: Date.now() - startedAt, candidates: candidates.length,
    verdict, level, reason, visible_words: visibleWords.length, input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 }));
  return reply({
    ok: true, version: VERSION, model, verdict, choice: verdict === "match" ? choice : 0, level: verdict === "match" ? level : "none",
    brand: chosen?.brand ?? "", product: chosen && level === "product" ? chosen.product : "", confidence: verdict === "match" ? confidence : 0,
    visible_words: visibleWords, reason,
  }, 200, origin);
});
