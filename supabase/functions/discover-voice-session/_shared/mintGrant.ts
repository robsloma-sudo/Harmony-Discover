// Picks the voice engine for one Marty start and mints the grant (P-20261126-0102 part 1). Pure: fetch injected.
// Runs only after the 21+ check, sign-in, consent and rate limit have all passed (see index.ts).
import { buildRealtimeSession, MODEL, type VoiceMode } from "./realtimeSession.ts";
import {
  buildElevenLabsPrompt, chooseEngine, type ElevenCache, elevenCache, type ElevenConnection, elevenLabsGrant,
  mintElevenLabs, resolveVoiceEngine, type VoiceEngine,
} from "./elevenlabs.ts";
import type { ScreenContext } from "./screenContext.ts";
import type { Pick } from "./martyDelivery.ts";

export const OPENAI_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

export interface MintGrantArgs {
  mode: VoiceMode;
  screenContext: ScreenContext | null;
  voiceEngines: VoiceEngine[] | null;
  elevenLabsConnection: ElevenConnection;
  memoryContext: string;
  characterBook: string;
  lookupsEnabled: boolean;
  env: {
    openAiKey: string;
    elevenLabsKey?: string;
    voiceEngineEnv?: string; // optional MARTY_VOICE_ENGINE override; unset = code default (ElevenLabs)
    elevenLabsVoiceId?: string;
    elevenLabsAgentId?: string;
    elevenLabsLlm?: string;
    voiceEnv?: string;
    handsFreeEnv?: string;
  };
  codeDefault?: VoiceEngine; // tests only
  pick?: Pick;
  cache?: ElevenCache;
}
export interface MintGrantResult { status: number; body: Record<string, unknown>; engine: VoiceEngine; fellBack?: string }
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

async function mintOpenAi(a: MintGrantArgs, fetchImpl: FetchLike): Promise<MintGrantResult> {
  if (!a.env.openAiKey) return { status: 503, body: { error: "Bartender voice is not configured in Discover DEV." }, engine: "openai" };
  const built = buildRealtimeSession({
    voiceEnv: a.env.voiceEnv, handsFreeEnv: a.env.handsFreeEnv, lookupsEnabled: a.lookupsEnabled,
    characterBook: a.characterBook, mode: a.mode, screenContext: a.screenContext, memoryContext: a.memoryContext, pick: a.pick,
  });
  let response: Response;
  try {
    response = await fetchImpl(OPENAI_CLIENT_SECRETS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${a.env.openAiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 60 }, session: built.session }),
    });
  } catch {
    return { status: 503, body: { error: "The bartender is temporarily unavailable." }, engine: "openai" };
  }
  if (!response.ok) {
    console.error("Marty Realtime credential request failed:", response.status);
    return { status: 503, body: { error: "The bartender is temporarily unavailable." }, engine: "openai" };
  }
  // deno-lint-ignore no-explicit-any
  let payload: any = {};
  try { payload = await response.json(); } catch { /* handled below */ }
  if (typeof payload.value !== "string" || !payload.value || !payload.expires_at) {
    return { status: 502, body: { error: "The voice provider returned an incomplete session grant." }, engine: "openai" };
  }
  // Exactly today's answer shape: old app copies depend on it.
  return {
    status: 200, engine: "openai",
    body: {
      sessionId: payload.session?.id ?? crypto.randomUUID(),
      provider: "openai_realtime",
      ephemeralToken: payload.value,
      expiresAt: new Date(Number(payload.expires_at) * 1000).toISOString(),
      transport: "webrtc",
      model: MODEL,
      voice: built.voice,
      mode: built.mode,
    },
  };
}

export async function mintGrant(a: MintGrantArgs, fetchImpl: FetchLike = fetch): Promise<MintGrantResult> {
  const switchEngine = resolveVoiceEngine(a.env.voiceEngineEnv, a.codeDefault);
  const engine = chooseEngine(switchEngine, a.voiceEngines, !!a.env.elevenLabsKey);
  if (engine === "openai") return mintOpenAi(a, fetchImpl);

  const prompt = buildElevenLabsPrompt({
    mode: a.mode, handsFreeEnv: a.env.handsFreeEnv, characterBook: a.characterBook, lookupsEnabled: a.lookupsEnabled,
    screenContext: a.screenContext, memoryContext: a.memoryContext, pick: a.pick,
  });
  const r = await mintElevenLabs(prompt.shared, prompt.lookups, {
    apiKey: a.env.elevenLabsKey ?? "", voiceId: a.env.elevenLabsVoiceId, agentId: a.env.elevenLabsAgentId, llm: a.env.elevenLabsLlm,
  }, a.elevenLabsConnection, fetchImpl, a.cache ?? elevenCache);
  if (!r.ok) {
    // Guests still get Marty: fall back to today's OpenAI voice. Only the step and status are logged.
    console.error("Marty ElevenLabs start failed, using OpenAI voice:", r.step, r.status);
    const fb = await mintOpenAi(a, fetchImpl);
    return { ...fb, fellBack: r.step };
  }
  return { status: 200, engine: "elevenlabs", body: elevenLabsGrant(r, prompt.session, prompt.mode, a.elevenLabsConnection) };
}
