import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildCurrent, compareAllowed, MARTY_BOSTON_CONSENT_VERSION, MAX_REQUEST_BYTES, mintContender, parseCompareRequest, RATE_LIMIT } from "./_shared/compare.ts";
import { ageGate } from "../discover-voice-session/_shared/ageCheck.ts";
import { ELEVENLABS_KEY_MISSING, runElevenLabs } from "./_shared/elevenlabs.ts";

// Listening test only (P-20261125-0219 part 1b). Same guards as discover-voice-session; hidden unless switched on for named users.
const DEV_REF = "lqqmwqrffelgnbngrkep";
// Same rule as discover-voice-session, written without a regex (the deploy tool garbles backslash escapes).
function siteOrigin(origin: string): boolean {
  const prefix = "https://";
  const suffix = "harmony-discover.netlify.app";
  if (!origin.startsWith(prefix) || !origin.endsWith(suffix)) return false;
  const label = origin.slice(prefix.length, origin.length - suffix.length);
  if (label === "") return true;
  if (!label.endsWith("--") || label.length < 3) return false;
  return label.slice(0, -2).split("").every((c) => (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-");
}
const ALLOWED_HEADERS = "authorization, apikey, content-type, x-client-info";
const ALLOWED_METHODS = "POST, OPTIONS";

function configuredOrigins(): Set<string> {
  return new Set((Deno.env.get("DISCOVER_ALLOWED_ORIGINS") ?? "").split(",").map((value) => value.trim()).filter(Boolean).map((value) => {
    try { const parsed = new URL(value); return parsed.origin === value ? parsed.origin : ""; }
    catch { return ""; }
  }).filter(Boolean));
}
function originAllowed(origin: string | null): boolean {
  if (!origin) return true;
  if (siteOrigin(origin)) return true;
  return configuredOrigins().has(origin);
}
function responseHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, private",
    "Pragma": "no-cache",
    "Vary": "Origin",
  });
  if (origin && originAllowed(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
    headers.set("Access-Control-Max-Age", "600");
  }
  return headers;
}
function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}
const notFound = (origin: string | null) => json({ error: "Not found." }, 404, origin);

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (!originAllowed(origin)) return json({ error: "Origin is not allowed." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const openAiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    if (Deno.env.get("DISCOVER_ENV") !== "development" ||
        new URL(supabaseUrl).hostname !== `${DEV_REF}.supabase.co` ||
        Deno.env.get("DISCOVER_PROJECT_REF") !== DEV_REF) {
      return json({ error: "Voice sessions are disabled outside the approved Discover DEV environment." }, 503, origin);
    }
    // Switch off: anyone (guest or not) sees a plain 404 before any other check.
    if (Deno.env.get("MARTY_COMPARE") !== "on") return notFound(origin);
    if (!anonKey || !serviceKey || !openAiKey) return json({ error: "Bartender voice is not configured in Discover DEV." }, 503, origin);

    const authorization = request.headers.get("Authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) return notFound(origin);

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return notFound(origin);
    if (!compareAllowed(Deno.env.get("MARTY_COMPARE"), Deno.env.get("MARTY_COMPARE_USERS"), authData.user.id)) return notFound(origin);

    const contentType = request.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) return json({ error: "Content-Type must be application/json." }, 415, origin);
    const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
    if (declaredLength > MAX_REQUEST_BYTES) return json({ error: "Request body is too large." }, 413, origin);
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) return json({ error: "Request body is too large." }, 413, origin);
    let input: unknown;
    try { input = JSON.parse(rawBody); } catch { return json({ error: "Request body must be valid JSON." }, 400, origin); }
    const parsed = parseCompareRequest(input);
    if (!parsed.ok) return json({ error: "A valid contender, mode and current voice consent are required." }, 400, origin);
    // 21+ age check (same rule as Marty): refuse before consent look-up, rate limit or any paid provider call.
    const ageBlock = ageGate(parsed.ageConfirmed, Deno.env.get("MARTY_AGE_CHECK"));
    if (ageBlock) return json(ageBlock.body, ageBlock.status, origin);
    // ElevenLabs option (P-20261126-0004 part 1): reached only by the Rob-only, signed-in, 21+ caller above.
    // Missing key: one plain answer, before consent look-up, rate-limit count or any call out.
    const elevenLabsKey = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
    if (parsed.voice === "elevenlabs" && !elevenLabsKey) return json(ELEVENLABS_KEY_MISSING, 503, origin);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: consent, error: consentError } = await admin
      .from("bartender_voice_consents").select("*").eq("user_id", authData.user.id).maybeSingle();
    if (consentError) return json({ error: "Could not verify voice consent." }, 503, origin);
    if (!consent?.voice_enabled ||
        consent.voice_consent_version !== MARTY_BOSTON_CONSENT_VERSION ||
        consent.voice_withdrawn_at) {
      return json({ error: "Voice consent is not active." }, 403, origin);
    }

    const windowStart = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();
    const { data: allowed, error: rateError } = await admin.rpc("consume_marty_voice_rate_limit", {
      p_user_id: authData.user.id, p_window_start: windowStart, p_limit: RATE_LIMIT,
    });
    if (rateError) return json({ error: "Voice session protection is not ready." }, 503, origin);
    if (allowed !== true) return json({ error: "Too many voice sessions. Wait a minute and try again." }, 429, origin);

    if (parsed.voice === "elevenlabs") {
      const el = await runElevenLabs(parsed, {
        apiKey: elevenLabsKey,
        voiceId: (Deno.env.get("ELEVENLABS_VOICE_ID") ?? "").trim(),
        agentId: (Deno.env.get("ELEVENLABS_AGENT_ID") ?? "").trim(),
      }, () => buildCurrent(parsed.mode, Deno.env.get("MARTY_VOICE"), Deno.env.get("MARTY_HANDS_FREE")).session.instructions);
      return json(el.body, el.status, origin);
    }

    const result = await mintContender(parsed, {
      openAiKey,
      geminiKey: Deno.env.get("GEMINI_API_KEY") ?? "",
      orderEnv: Deno.env.get("MARTY_COMPARE_ORDER") ?? undefined,
      voiceEnv: Deno.env.get("MARTY_VOICE"),
      handsFreeEnv: Deno.env.get("MARTY_HANDS_FREE"),
    });
    return json(result.body, result.status, origin);
  } catch {
    return json({ error: "Could not start the listening test." }, 500, origin);
  }
});
