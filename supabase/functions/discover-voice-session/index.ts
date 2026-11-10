import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { martyBostonInstructions, martyBostonComedyCraft, MARTY_BOSTON_CONSENT_VERSION } from "../../../src/voice/martySullivanBoston.ts";

const DEV_REF = "lqqmwqrffelgnbngrkep";
const MODEL = "gpt-realtime-2.1";
const VOICE = "ash"; // audition baseline only; not a confirmed Boston voice selection.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const openAiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    if (Deno.env.get("DISCOVER_ENV") !== "development" ||
        new URL(supabaseUrl).hostname !== `${DEV_REF}.supabase.co` ||
        Deno.env.get("DISCOVER_PROJECT_REF") !== DEV_REF) {
      return json({ error: "Voice sessions are disabled outside the approved Discover DEV environment." }, 503);
    }
    if (!anonKey || !serviceKey || !openAiKey) return json({ error: "Bartender voice is not configured in Discover DEV." }, 503);

    const authorization = request.headers.get("Authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) return json({ error: "Sign in before starting voice." }, 401);

    const input = await request.json().catch(() => null);
    if (!input || input.consentVersion !== MARTY_BOSTON_CONSENT_VERSION || input.mode !== "push_to_talk") {
      return json({ error: "A current, explicit push-to-talk consent is required." }, 400);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your sign-in has expired. Please sign in again." }, 401);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: consent, error: consentError } = await admin
      .from("bartender_voice_consents").select("*").eq("user_id", authData.user.id).maybeSingle();
    if (consentError) return json({ error: "Could not verify voice consent." }, 503);
    if (!consent?.voice_enabled ||
        consent.voice_consent_version !== MARTY_BOSTON_CONSENT_VERSION ||
        consent.voice_withdrawn_at) {
      return json({ error: "Voice consent is not active." }, 403);
    }

    const windowStart = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();
    const { data: allowed, error: rateError } = await admin.rpc("consume_marty_voice_rate_limit", {
      p_user_id: authData.user.id, p_window_start: windowStart, p_limit: 8,
    });
    if (rateError) return json({ error: "Voice session protection is not ready." }, 503);
    if (allowed !== true) return json({ error: "Too many voice sessions. Wait a minute and try again." }, 429);

    let memoryContext = "";
    if (consent.memory_enabled && consent.memory_consent_version === MARTY_BOSTON_CONSENT_VERSION && !consent.memory_withdrawn_at) {
      const { data: memories, error: memoryError } = await admin
        .from("bartender_memories")
        .select("category,label,value")
        .eq("user_id", authData.user.id)
        .order("updated_at", { ascending: false })
        .limit(30);
      if (memoryError) return json({ error: "Could not safely load saved bartender memories." }, 503);
      if (memories?.length) {
        memoryContext = "\n\nUSER-APPROVED GUEST MEMORY (private to this signed-in account):\n" +
          memories.map((m: { category: string; label: string; value: string }) => `- ${m.category}: ${m.label} — ${m.value}`).join("\n") +
          "\nUse naturally, never recite as a dossier. These are user-confirmed details, not permission to infer sensitive traits. Accept corrections and honor deletion.";
      }
    }

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
          type: "realtime",
          model: MODEL,
          instructions: martyBostonInstructions + martyBostonComedyCraft + memoryContext,
          output_modalities: ["audio"],
          audio: {
            input: { transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: null },
            output: { voice: VOICE, speed: 0.92 },
          },
        },
      }),
    });
    if (!response.ok) {
      // Never return provider response bodies or credentials to the client.
      console.error("Marty Realtime credential request failed:", response.status);
      return json({ error: "The bartender is temporarily unavailable." }, 503);
    }
    const payload = await response.json();
    if (typeof payload.value !== "string" || !payload.value || !payload.expires_at) {
      return json({ error: "The voice provider returned an incomplete session grant." }, 502);
    }

    return json({
      sessionId: payload.session?.id ?? crypto.randomUUID(),
      provider: "openai_realtime",
      ephemeralToken: payload.value,
      expiresAt: new Date(Number(payload.expires_at) * 1000).toISOString(),
      transport: "webrtc",
      model: MODEL,
      voice: VOICE,
    });
  } catch {
    return json({ error: "Could not start the bartender voice session." }, 500);
  }
});
