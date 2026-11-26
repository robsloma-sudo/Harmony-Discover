// ElevenLabs Boston voice for Marty's hidden, Rob-only listening test (P-20261126-0004 part 1).
// Pure logic: no Deno globals, no database. The ElevenLabs key is a server secret only and never leaves the server.
// ElevenLabs official API only (api.elevenlabs.io): voice design + their Agents (live conversation) service.
// ORIGINAL voice designed from a text description. Never cloned, never based on a real person: no voice-clone
// endpoint is called and no reference audio is ever sent (elevenlabs_test.ts checks both).
import type { VoiceMode } from "../../discover-voice-session/_shared/realtimeSession.ts";

export const ELEVENLABS_API = "https://api.elevenlabs.io";
export const ELEVENLABS_DESIGN_URL = `${ELEVENLABS_API}/v1/text-to-voice/design`;
export const ELEVENLABS_SAVE_VOICE_URL = `${ELEVENLABS_API}/v1/text-to-voice`;
export const ELEVENLABS_CREATE_AGENT_URL = `${ELEVENLABS_API}/v1/convai/agents/create`;
export const ELEVENLABS_TOKEN_URL = `${ELEVENLABS_API}/v1/convai/conversation/token`;

// Plain answer when the key is missing. Nothing else happens (no consent look-up, no rate-limit count, no call out).
export const ELEVENLABS_KEY_MISSING = { error: "ElevenLabs key not set" } as const;
export const ELEVENLABS_VOICE_MISSING = { error: "ElevenLabs voice not set" } as const;
export const ELEVENLABS_AGENT_MISSING = { error: "ElevenLabs agent not set" } as const;
const COULD_NOT_START = "This contender could not start.";

// ---- request fields (accepted by parseCompareRequest in compare.ts) -----------------------------
export const VOICE_FIELD = "voice";
export const VOICE_VALUES = ["current", "elevenlabs"] as const;
export type VoicePick = typeof VOICE_VALUES[number];
export const SETUP_FIELD = "setup";
export const SETUP_VALUES = ["design_voice", "save_voice", "create_agent"] as const;
export type SetupStep = typeof SETUP_VALUES[number];
export const GENERATED_VOICE_ID_FIELD = "generatedVoiceId";
export function validVoiceId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 64 &&
    value.split("").every((c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "-");
}

// ---- voice design (one-time setup, Rob only) -----------------------------------------------------
// Rob's exact description, plus "original, not based on any real person".
export const MARTY_VOICE_DESCRIPTION =
  "Gruff, older, working-class Boston bartender, male. Thick Boston accent with dropped Rs, raspy, impatient. " +
  "An original character voice, not based on or imitating any real person.";
// 100-1000 characters, read aloud in each preview. Original line, no real names.
export const MARTY_PREVIEW_TEXT =
  "Yeah, yeah, I hear ya. You want the lager or you want somethin' that ain't wicked boring? " +
  "Make up ya mind, pal, I got a whole bar here and the cah's double pahked out back.";
export const VOICE_DESIGN_MODEL = "eleven_ttv_v3";
export function buildVoiceDesignBody() {
  return {
    voice_description: MARTY_VOICE_DESCRIPTION,
    model_id: VOICE_DESIGN_MODEL,
    text: MARTY_PREVIEW_TEXT,
    auto_generate_text: false,
  };
}
export const MARTY_VOICE_NAME = "Marty - original Boston bartender (Discover test)";
export function buildSaveVoiceBody(generatedVoiceId: string) {
  return {
    voice_name: MARTY_VOICE_NAME,
    voice_description: MARTY_VOICE_DESCRIPTION,
    generated_voice_id: generatedVoiceId,
    labels: { source: "voice_design", use: "discover_listening_test" },
  };
}

// ---- the live agent ------------------------------------------------------------------------------
// ElevenLabs Agents is listen -> think -> speak. The Marty script (character book, rules, hard limits) is sent
// fresh with every session as an override, built by the same buildRealtimeSession call as today's voice, so the
// words he is given are identical; only the voice (and the thinking model ElevenLabs runs it on) differs.
// UNCONFIRMED (create-agent and overrides pages could not be read): field names below. Each is one line.
export const ELEVENLABS_LLM = "gpt-4.1";
export const ELEVENLABS_TTS_MODEL = "eleven_flash_v2";
export function buildAgentBody(voiceId: string, instructions: string) {
  return {
    name: "Marty listening test (Discover DEV)",
    conversation_config: {
      agent: { prompt: { prompt: instructions, llm: ELEVENLABS_LLM }, first_message: "", language: "en" },
      tts: { voice_id: voiceId, model_id: ELEVENLABS_TTS_MODEL },
    },
    platform_settings: {
      auth: { enable_auth: true }, // private agent: only a server-made token can start a conversation
      overrides: { conversation_config_override: { agent: { prompt: { prompt: true } }, tts: { voice_id: true } } },
    },
  };
}
export function buildSessionOverrides(voiceId: string, instructions: string) {
  return { agent: { prompt: { prompt: instructions } }, tts: { voiceId } };
}

// ---- running a request ---------------------------------------------------------------------------
export interface ElevenLabsEnv {
  apiKey: string;
  voiceId: string; // server setting ELEVENLABS_VOICE_ID
  agentId: string; // server setting ELEVENLABS_AGENT_ID
}
export interface ElevenLabsRequest {
  contender?: string;
  mode: VoiceMode;
  reveal: boolean;
  setup?: SetupStep;
  generatedVoiceId?: string;
}
export interface ElevenLabsResult { status: number; body: Record<string, unknown> }
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

async function call(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }> {
  let res: Response;
  try { res = await fetchImpl(url, init); } catch { return { ok: false, status: 0, payload: {} }; }
  let payload: Record<string, unknown> = {};
  try { payload = await res.json(); } catch { /* handled by caller */ }
  return { ok: res.ok, status: res.status, payload: payload ?? {} };
}
const fail = (status: number): ElevenLabsResult => ({ status: 502, body: { error: COULD_NOT_START, status } });

// Never returns, logs or forwards a provider error body or the key; only the status code.
export async function runElevenLabs(
  req: ElevenLabsRequest,
  env: ElevenLabsEnv,
  instructions: () => string,
  fetchImpl: FetchLike = fetch,
): Promise<ElevenLabsResult> {
  if (!env.apiKey) return { status: 503, body: { ...ELEVENLABS_KEY_MISSING } };
  const headers = { "xi-api-key": env.apiKey, "Content-Type": "application/json" };

  if (req.setup === "design_voice") {
    const r = await call(fetchImpl, ELEVENLABS_DESIGN_URL, { method: "POST", headers, body: JSON.stringify(buildVoiceDesignBody()) });
    const previews = Array.isArray(r.payload.previews) ? r.payload.previews as Record<string, unknown>[] : [];
    const out = previews.filter((p) => validVoiceId(p?.generated_voice_id) && typeof p?.audio_base_64 === "string")
      .slice(0, 3).map((p) => ({
        generatedVoiceId: p.generated_voice_id, audioBase64: p.audio_base_64,
        mediaType: typeof p.media_type === "string" ? p.media_type : "audio/mpeg",
      }));
    if (!r.ok || out.length === 0) return fail(r.status);
    return { status: 200, body: { setup: "design_voice", previews: out, next: "Pick one, then send setup save_voice with its generatedVoiceId." } };
  }

  if (req.setup === "save_voice") {
    if (!req.generatedVoiceId) return { status: 400, body: { error: "generatedVoiceId is required." } };
    const r = await call(fetchImpl, ELEVENLABS_SAVE_VOICE_URL, { method: "POST", headers, body: JSON.stringify(buildSaveVoiceBody(req.generatedVoiceId)) });
    if (!r.ok || !validVoiceId(r.payload.voice_id)) return fail(r.status);
    return { status: 200, body: { setup: "save_voice", voiceId: r.payload.voice_id, next: "Save it as the server setting ELEVENLABS_VOICE_ID." } };
  }

  if (!validVoiceId(env.voiceId)) return { status: 503, body: { ...ELEVENLABS_VOICE_MISSING } };

  if (req.setup === "create_agent") {
    const r = await call(fetchImpl, ELEVENLABS_CREATE_AGENT_URL, { method: "POST", headers, body: JSON.stringify(buildAgentBody(env.voiceId, instructions())) });
    if (!r.ok || !validVoiceId(r.payload.agent_id)) return fail(r.status);
    return { status: 200, body: { setup: "create_agent", agentId: r.payload.agent_id, next: "Save it as the server setting ELEVENLABS_AGENT_ID." } };
  }

  // A live session: a one-time conversation token for the private agent, plus today's Marty script as override.
  if (!validVoiceId(env.agentId)) return { status: 503, body: { ...ELEVENLABS_AGENT_MISSING } };
  const url = `${ELEVENLABS_TOKEN_URL}?agent_id=${encodeURIComponent(env.agentId)}`;
  const r = await call(fetchImpl, url, { method: "GET", headers: { "xi-api-key": env.apiKey } });
  if (!r.ok || typeof r.payload.token !== "string" || !r.payload.token) return fail(r.status);
  const body: Record<string, unknown> = {
    contender: req.contender ?? null,
    provider: "elevenlabs_agents",
    voice: "elevenlabs",
    conversationToken: r.payload.token,
    transport: "webrtc",
    overrides: buildSessionOverrides(env.voiceId, instructions()),
  };
  if (req.reveal) body.model = `elevenlabs:${ELEVENLABS_TTS_MODEL}+${ELEVENLABS_LLM}`;
  return { status: 200, body };
}
