// ElevenLabs voice for the Rob-only Marty listening test (P-20261126-0004 part 1). Pure logic, fetch injected.
// Official ElevenLabs API only (api.elevenlabs.io), server key from the Edge Functions secret ELEVENLABS_API_KEY.
// The key never leaves the server; the app only gets a one-conversation WebRTC token.
//
// Flow on each ElevenLabs start (all server side):
//  1. Voice: ELEVENLABS_VOICE_ID if set, else find our own designed voice by its exact name, else DESIGN a new
//     ORIGINAL voice from a text description (never a clone, never a real person) and save it.
//  2. Agent: ELEVENLABS_AGENT_ID if set, else find our agent by its exact name, else create it.
//  3. Update the agent with today's exact Marty script (same builder as every other contender) and the voice,
//     so the only difference from today's Marty is the voice (and ElevenLabs' own thinking model).
//  4. Ask for a WebRTC conversation token for that agent and return it.
// Confirmed from ElevenLabs docs (read 26 Nov 2026): text-to-voice/design and text-to-voice request/response
// fields, GET /v1/convai/conversation/token?agent_id= -> { token, conversation_id }, xi-api-key header,
// client Conversation.startSession({ conversationToken, connectionType: "webrtc" }).
// UNCONFIRMED (agent pages could not be read): agent create/update/list paths and body shape
// (conversation_config.agent.prompt.prompt, agent.language, tts.voice_id, tts.model_id),
// /v2/voices?search= list shape. Each is one line below; a refusal reports only the step and status code.

export const ELEVENLABS_API = "https://api.elevenlabs.io";
export const ELEVENLABS_KEY_MISSING = "ElevenLabs key not set.";
export const MARTY_VOICE_NAME = "Marty Boston Bartender (original, Harmony listening test)";
export const MARTY_AGENT_NAME = "Marty listening test (Harmony Discover, Rob only)";
export const VOICE_DESIGN_MODEL = "eleven_ttv_v3";
// English-only agents use the low-latency Flash TTS model.
export const AGENT_TTS_MODEL = "eleven_flash_v2";

// Original voice, designed from words only. No real person is named or imitated.
export const MARTY_VOICE_DESCRIPTION =
  "An original, fictional character voice: a gruff older working-class Boston bartender in his sixties, " +
  "thick old-school Boston accent with dropped Rs, raspy and gravelly, low pitch, impatient and dry, " +
  "speaking fast in short clipped sentences, close-mic'd in a quiet room.";
export const MARTY_VOICE_SAMPLE_TEXT =
  "Yeah, yeah, I heard ya the first time. You want a drink or you want a lecture? " +
  "Park the car, grab a stool, and tell me what you're having before I lose my patience, pal.";

export type VoicePick = "current" | "elevenlabs";
export const VOICE_PICKS: readonly string[] = ["current", "elevenlabs"];

export interface ElevenEnv {
  apiKey: string;
  voiceId?: string;
  agentId?: string;
  llm?: string; // optional ELEVENLABS_LLM; unset = the agent's default thinking model
}
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export type ElevenResult = { ok: true; token: string; voiceId: string; agentId: string } | { ok: false; step: string; status: number };

function headers(apiKey: string): Record<string, string> {
  return { "xi-api-key": apiKey, "Content-Type": "application/json" };
}
async function call(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try { res = await fetchImpl(url, init); } catch { return { status: 0, body: null }; }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* handled by caller */ }
  return { status: res.ok ? 200 : res.status, body };
}
const str = (v: unknown) => (typeof v === "string" && v ? v : "");

export function buildVoiceDesignBody() {
  return { voice_description: MARTY_VOICE_DESCRIPTION, model_id: VOICE_DESIGN_MODEL, text: MARTY_VOICE_SAMPLE_TEXT };
}
export function buildAgentConfig(instructions: string, voiceId: string, llm?: string) {
  const prompt: Record<string, unknown> = { prompt: instructions };
  if (llm) prompt.llm = llm;
  return {
    name: MARTY_AGENT_NAME,
    conversation_config: {
      agent: { prompt, language: "en" },
      tts: { voice_id: voiceId, model_id: AGENT_TTS_MODEL },
    },
  };
}

async function findVoice(f: FetchLike, key: string): Promise<{ id: string } | { step: string; status: number }> {
  const r = await call(f, `${ELEVENLABS_API}/v2/voices?search=${encodeURIComponent(MARTY_VOICE_NAME)}`, { method: "GET", headers: headers(key) });
  if (r.status !== 200) return { step: "voice_list", status: r.status };
  const voices = (r.body as { voices?: { voice_id?: unknown; name?: unknown }[] })?.voices ?? [];
  const hit = voices.find((v) => v?.name === MARTY_VOICE_NAME && str(v.voice_id));
  return { id: hit ? str(hit.voice_id) : "" };
}
async function designVoice(f: FetchLike, key: string): Promise<{ id: string } | { step: string; status: number }> {
  const d = await call(f, `${ELEVENLABS_API}/v1/text-to-voice/design`, { method: "POST", headers: headers(key), body: JSON.stringify(buildVoiceDesignBody()) });
  if (d.status !== 200) return { step: "voice_design", status: d.status };
  const gen = str((d.body as { previews?: { generated_voice_id?: unknown }[] })?.previews?.[0]?.generated_voice_id);
  if (!gen) return { step: "voice_design", status: 200 };
  const c = await call(f, `${ELEVENLABS_API}/v1/text-to-voice`, {
    method: "POST", headers: headers(key),
    body: JSON.stringify({ voice_name: MARTY_VOICE_NAME, voice_description: MARTY_VOICE_DESCRIPTION, generated_voice_id: gen }),
  });
  const id = str((c.body as { voice_id?: unknown })?.voice_id);
  if (c.status !== 200 || !id) return { step: "voice_save", status: c.status };
  return { id };
}
async function findAgent(f: FetchLike, key: string): Promise<{ id: string } | { step: string; status: number }> {
  const r = await call(f, `${ELEVENLABS_API}/v1/convai/agents?search=${encodeURIComponent(MARTY_AGENT_NAME)}`, { method: "GET", headers: headers(key) });
  if (r.status !== 200) return { step: "agent_list", status: r.status };
  const agents = (r.body as { agents?: { agent_id?: unknown; name?: unknown }[] })?.agents ?? [];
  const hit = agents.find((a) => a?.name === MARTY_AGENT_NAME && str(a.agent_id));
  return { id: hit ? str(hit.agent_id) : "" };
}

// Never returns, logs or forwards a provider body or key: only the failing step name and status code.
export async function mintElevenLabs(instructions: string, env: ElevenEnv, fetchImpl: FetchLike = fetch): Promise<ElevenResult> {
  const key = env.apiKey;
  let voiceId = (env.voiceId ?? "").trim();
  if (!voiceId) {
    const found = await findVoice(fetchImpl, key);
    if ("step" in found) return { ok: false, ...found };
    voiceId = found.id;
    if (!voiceId) {
      const made = await designVoice(fetchImpl, key);
      if ("step" in made) return { ok: false, ...made };
      voiceId = made.id;
    }
  }
  const config = buildAgentConfig(instructions, voiceId, (env.llm ?? "").trim() || undefined);
  let agentId = (env.agentId ?? "").trim();
  if (!agentId) {
    const found = await findAgent(fetchImpl, key);
    if ("step" in found) return { ok: false, ...found };
    agentId = found.id;
  }
  if (!agentId) {
    const c = await call(fetchImpl, `${ELEVENLABS_API}/v1/convai/agents/create`, { method: "POST", headers: headers(key), body: JSON.stringify(config) });
    agentId = str((c.body as { agent_id?: unknown })?.agent_id);
    if (c.status !== 200 || !agentId) return { ok: false, step: "agent_create", status: c.status };
  } else {
    // Keep the agent's script identical to today's Marty on every start.
    const u = await call(fetchImpl, `${ELEVENLABS_API}/v1/convai/agents/${encodeURIComponent(agentId)}`, { method: "PATCH", headers: headers(key), body: JSON.stringify(config) });
    if (u.status !== 200) return { ok: false, step: "agent_update", status: u.status };
  }
  const t = await call(fetchImpl, `${ELEVENLABS_API}/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`, { method: "GET", headers: { "xi-api-key": key } });
  const token = str((t.body as { token?: unknown })?.token);
  if (t.status !== 200 || !token) return { ok: false, step: "token", status: t.status };
  return { ok: true, token, voiceId, agentId };
}
