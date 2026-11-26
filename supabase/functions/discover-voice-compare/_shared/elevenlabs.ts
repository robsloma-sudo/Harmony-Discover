// ElevenLabs voice for the Rob-only Marty listening test (P-20261126-0004 part 1). Pure logic, fetch injected.
// Official ElevenLabs API only (api.elevenlabs.io), server key from the Edge Functions secret ELEVENLABS_API_KEY.
// The key never leaves the server; the app only gets a one-conversation WebRTC token.
//
// Flow on each ElevenLabs start (all server side):
//  1. Voice: always Rob's own original voice "Marty" (MARTY_VOICE_ID below), unless the ELEVENLABS_VOICE_ID
//     secret overrides it. The server checks that the voice exists (GET /v1/voices/{voice_id}); it NEVER designs,
//     saves or changes a voice on Rob's account. If the voice cannot be found it stops with step voice_not_found.
//  2. Agent: ELEVENLABS_AGENT_ID if set, else find our agent by its exact name, else create it.
//  3. Update the agent with today's exact Marty script (same builder as every other contender) and the voice,
//     so the only difference from today's Marty is the voice (and ElevenLabs' own thinking model).
//  4. Ask for a WebRTC conversation token for that agent and return it.
// Confirmed from ElevenLabs docs (read 26 Nov 2026): GET /v1/convai/conversation/token?agent_id= ->
// { token, conversation_id }, xi-api-key header, client Conversation.startSession({ conversationToken,
// connectionType: "webrtc" }).
// UNCONFIRMED (pages not re-read this session): GET /v1/voices/{voice_id} -> { voice_id, ... } (ElevenLabs' standard
// get-voice call), and agent create/update/list paths and body shape (conversation_config.agent.prompt.prompt,
// agent.language, tts.voice_id, tts.model_id). Each is one line below;
// a refusal reports only the step and status code.

export const ELEVENLABS_API = "https://api.elevenlabs.io";
export const ELEVENLABS_KEY_MISSING = "ElevenLabs key not set.";
// Rob's own original voice "Marty", designed and saved by Rob himself in ElevenLabs (category: generated).
// Not a secret: a voice id only works with Rob's key. Override with the ELEVENLABS_VOICE_ID secret.
export const MARTY_VOICE_ID = "p9Y6zzVEQV7SMw7VcCkd";
export const MARTY_AGENT_NAME = "Marty listening test (Harmony Discover, Rob only)";
// English-only agents use the low-latency Flash TTS model.
export const AGENT_TTS_MODEL = "eleven_flash_v2";

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

// Checks the voice exists on Rob's account. Read-only: never designs, saves or edits a voice.
async function checkVoice(f: FetchLike, key: string, voiceId: string): Promise<{ step: string; status: number } | null> {
  const r = await call(f, `${ELEVENLABS_API}/v1/voices/${encodeURIComponent(voiceId)}`, { method: "GET", headers: { "xi-api-key": key } });
  if (r.status === 200 && str((r.body as { voice_id?: unknown })?.voice_id) === voiceId) return null;
  if (r.status === 200 || r.status === 400 || r.status === 404 || r.status === 422) return { step: "voice_not_found", status: r.status };
  return { step: "voice_check", status: r.status };
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
  const voiceId = (env.voiceId ?? "").trim() || MARTY_VOICE_ID;
  const missing = await checkVoice(fetchImpl, key, voiceId);
  if (missing) return { ok: false, ...missing };
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
