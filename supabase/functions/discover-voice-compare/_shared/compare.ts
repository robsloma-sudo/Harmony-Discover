// Pure logic for the Marty voice listening test (P-20261125-0219 part 1b). No Deno globals, no database.
// Read-only imports from discover-voice-session so every contender gets the identical Marty script.
import { MARTY_BOSTON_CONSENT_VERSION } from "../../discover-voice-session/_shared/martySullivanBoston.ts";
import { martyCharacterBook } from "../../discover-voice-session/_shared/martyCharacterBook.ts";
import {
  buildRealtimeSession,
  DISCOVER_NAVIGATION_TOOLS,
  MODEL as CURRENT_MODEL,
  type VoiceMode,
} from "../../discover-voice-session/_shared/realtimeSession.ts";

export { MARTY_BOSTON_CONSENT_VERSION, CURRENT_MODEL };

export const MAX_REQUEST_BYTES = 1024;
export const RATE_LIMIT = 4;

export type ModelKey = "current" | "gpt-live-1" | "gemini";
export type Letter = "A" | "B" | "C";
export const DEFAULT_ORDER = "current,gpt-live-1,gemini";
const MODEL_KEYS: readonly string[] = ["current", "gpt-live-1", "gemini"];
const LETTERS: readonly string[] = ["A", "B", "C"];

// ---- access gate -------------------------------------------------------------------------------
// Off unless MARTY_COMPARE === "on" AND the signed-in user id is in MARTY_COMPARE_USERS (comma separated).
export function compareAllowed(flag: string | undefined | null, usersCsv: string | undefined | null, userId: string | undefined | null): boolean {
  if (flag !== "on") return false;
  if (!userId) return false;
  const wanted = userId.trim().toLowerCase();
  if (!wanted) return false;
  return (usersCsv ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean).includes(wanted);
}

// ---- blind mapping -----------------------------------------------------------------------------
// A bad or incomplete order falls back to the default so a typo never breaks or leaks the mapping.
export function parseOrder(orderEnv: string | undefined | null): ModelKey[] {
  const parts = (orderEnv ?? DEFAULT_ORDER).split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  const valid = parts.length === 3 && parts.every((p) => MODEL_KEYS.includes(p)) && new Set(parts).size === 3;
  return (valid ? parts : DEFAULT_ORDER.split(",")) as ModelKey[];
}
export function resolveContender(orderEnv: string | undefined | null, letter: string): ModelKey | null {
  const index = LETTERS.indexOf(letter);
  if (index < 0) return null;
  return parseOrder(orderEnv)[index];
}

// ---- request -----------------------------------------------------------------------------------
const ALLOWED_KEYS = new Set(["consentVersion", "contender", "mode", "reveal"]);
export type CompareRequestResult =
  | { ok: true; contender: Letter; mode: VoiceMode; reveal: boolean }
  | { ok: false };
export function parseCompareRequest(input: unknown): CompareRequestResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false };
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((k) => !ALLOWED_KEYS.has(k))) return { ok: false };
  if (body.consentVersion !== MARTY_BOSTON_CONSENT_VERSION) return { ok: false };
  if (typeof body.contender !== "string" || !LETTERS.includes(body.contender)) return { ok: false };
  if (body.mode !== "push_to_talk" && body.mode !== "hands_free") return { ok: false };
  if (body.reveal !== undefined && typeof body.reveal !== "boolean") return { ok: false };
  return { ok: true, contender: body.contender as Letter, mode: body.mode, reveal: body.reveal === true };
}

// ---- contender payloads ------------------------------------------------------------------------
// OpenAI client secret endpoint. Used by "current" (confirmed, today's flow) and "gpt-live-1" (UNCONFIRMED).
export const OPENAI_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

// UNCONFIRMED (from OpenAI's model page only; guide pages could not be read): model id "gpt-live-1";
// function calling supported; default voice "marin", fixed per session; turns are server-driven (no client
// response.create or cancel); WebRTC recommended; WebSocket wss://api.openai.com/v1/live/sessions.
// We therefore send only type, model, instructions, tools and the voice. Left out on purpose because it may not
// accept them: max_output_tokens, speed, turn_detection, input transcription, noise reduction, output_modalities.
export const GPT_LIVE_MODEL = "gpt-live-1";
export const GPT_LIVE_VOICE = "marin";
export const GPT_LIVE_CLIENT_SECRETS_URL = OPENAI_CLIENT_SECRETS_URL;
export function buildGptLiveSession(instructions: string, voice: string = GPT_LIVE_VOICE) {
  return {
    type: "realtime",
    model: GPT_LIVE_MODEL,
    instructions,
    tools: DISCOVER_NAVIGATION_TOOLS, // the 2 navigation tools only: no look-ups, so voices compare fairly
    audio: { output: { voice } },
  };
}

// UNCONFIRMED (ephemeral-tokens page could not be read): Gemini Live API, model "gemini-3.8-live",
// single-use ephemeral token from v1alpha auth_tokens, browser connects over WebSocket.
export const GEMINI_MODEL = "gemini-3.8-live";
export const GEMINI_AUTH_TOKENS_URL = "https://generativelanguage.googleapis.com/v1alpha/auth_tokens";
export function buildGeminiTokenBody(instructions: string, now: Date = new Date()) {
  return {
    uses: 1,
    expireTime: new Date(now.getTime() + 30 * 60000).toISOString(),
    newSessionExpireTime: new Date(now.getTime() + 60000).toISOString(),
    liveConnectConstraints: {
      model: `models/${GEMINI_MODEL}`,
      config: {
        systemInstruction: { parts: [{ text: instructions }] },
        responseModalities: ["AUDIO"],
      },
    },
  };
}

// The compared Marty is the real Marty minus look-ups: same character book, passed the same way as
// discover-voice-session/index.ts does, and look-ups switched OFF (no look-up instructions, no look-up tools),
// because this test has no look-up relay. Every contender therefore gets the same script and only the
// 2 navigation tools, and none is told about a tool it cannot use.
export const COMPARE_LOOKUPS_ENABLED = false;
export function buildCurrent(mode: VoiceMode, voiceEnv: string | undefined, handsFreeEnv: string | undefined) {
  return buildRealtimeSession({
    voiceEnv, handsFreeEnv, mode, characterBook: martyCharacterBook, lookupsEnabled: COMPARE_LOOKUPS_ENABLED,
  });
}

// Every file the deploy bundle must carry (this folder plus the read-only discover-voice-session/_shared files
// it imports). compare_test.ts walks the real import graph and fails if this list is missing one.
export const DEPLOY_FILES = [
  "discover-voice-compare/index.ts",
  "discover-voice-compare/_shared/compare.ts",
  "discover-voice-session/_shared/martyCharacterBook.ts",
  "discover-voice-session/_shared/martyDelivery.ts",
  "discover-voice-session/_shared/martySullivanBoston.ts",
  "discover-voice-session/_shared/realtimeSession.ts",
  "discover-voice-session/_shared/screenContext.ts",
] as const;

// ---- minting -----------------------------------------------------------------------------------
export interface MintEnv {
  openAiKey: string;
  geminiKey: string;
  orderEnv?: string;
  voiceEnv?: string;
  handsFreeEnv?: string;
}
export interface MintResult { status: number; body: Record<string, unknown> }
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const COULD_NOT_START = "This contender could not start.";

// Never returns, logs or forwards a provider response body or key; only the status code.
export async function mintContender(
  req: { contender: Letter; mode: VoiceMode; reveal: boolean },
  env: MintEnv,
  fetchImpl: FetchLike = fetch,
  now: Date = new Date(),
): Promise<MintResult> {
  const which = resolveContender(env.orderEnv, req.contender);
  if (!which) return { status: 400, body: { error: "Unknown contender." } };

  if (which === "gemini") {
    if (!env.geminiKey) return { status: 503, body: { error: "Contender not configured." } };
    const built = buildCurrent(req.mode, env.voiceEnv, env.handsFreeEnv);
    let res: Response;
    try {
      res = await fetchImpl(GEMINI_AUTH_TOKENS_URL, {
        method: "POST",
        headers: { "x-goog-api-key": env.geminiKey, "Content-Type": "application/json" },
        body: JSON.stringify(buildGeminiTokenBody(built.session.instructions, now)),
      });
    } catch {
      return { status: 502, body: { error: COULD_NOT_START, status: 0 } };
    }
    if (!res.ok) return { status: 502, body: { error: COULD_NOT_START, status: res.status } };
    let payload: { name?: unknown } = {};
    try { payload = await res.json(); } catch { /* handled below */ }
    if (typeof payload.name !== "string" || !payload.name) return { status: 502, body: { error: COULD_NOT_START, status: res.status } };
    const body: Record<string, unknown> = {
      contender: req.contender, provider: "gemini_live", ephemeralToken: payload.name, transport: "websocket",
    };
    if (req.reveal) body.model = GEMINI_MODEL;
    return { status: 200, body };
  }

  const built = buildCurrent(req.mode, env.voiceEnv, env.handsFreeEnv);
  const isCurrent = which === "current";
  const session = isCurrent ? built.session : buildGptLiveSession(built.session.instructions);
  const url = isCurrent ? OPENAI_CLIENT_SECRETS_URL : GPT_LIVE_CLIENT_SECRETS_URL;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openAiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 60 }, session }),
    });
  } catch {
    return { status: 502, body: { error: COULD_NOT_START, status: 0 } };
  }
  if (!res.ok) return { status: 502, body: { error: COULD_NOT_START, status: res.status } };
  let payload: { value?: unknown; expires_at?: unknown } = {};
  try { payload = await res.json(); } catch { /* handled below */ }
  if (typeof payload.value !== "string" || !payload.value || !payload.expires_at) {
    return { status: 502, body: { error: COULD_NOT_START, status: res.status } };
  }
  const body: Record<string, unknown> = {
    contender: req.contender,
    provider: "openai_realtime",
    ephemeralToken: payload.value,
    expiresAt: new Date(Number(payload.expires_at) * 1000).toISOString(),
    transport: "webrtc",
    connectHint: isCurrent ? "realtime" : "live",
    voice: isCurrent ? built.voice : GPT_LIVE_VOICE,
  };
  if (req.reveal) body.model = isCurrent ? CURRENT_MODEL : GPT_LIVE_MODEL;
  return { status: 200, body };
}
