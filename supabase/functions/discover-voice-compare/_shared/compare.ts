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

export const MAX_REQUEST_BYTES = 16384; // room for one WebRTC offer (voice B relay)
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
const ALLOWED_KEYS = new Set(["consentVersion", "contender", "mode", "reveal", "sdp"]);
export type CompareRequestResult =
  | { ok: true; contender: Letter; mode: VoiceMode; reveal: boolean; sdp?: string }
  | { ok: false };
export function parseCompareRequest(input: unknown): CompareRequestResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false };
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((k) => !ALLOWED_KEYS.has(k))) return { ok: false };
  if (body.consentVersion !== MARTY_BOSTON_CONSENT_VERSION) return { ok: false };
  if (typeof body.contender !== "string" || !LETTERS.includes(body.contender)) return { ok: false };
  if (body.mode !== "push_to_talk" && body.mode !== "hands_free") return { ok: false };
  if (body.reveal !== undefined && typeof body.reveal !== "boolean") return { ok: false };
  if (body.sdp !== undefined && !validSdp(body.sdp)) return { ok: false };
  const out: CompareRequestResult = { ok: true, contender: body.contender as Letter, mode: body.mode, reveal: body.reveal === true };
  if (typeof body.sdp === "string") out.sdp = body.sdp;
  return out;
}

// ---- contender payloads ------------------------------------------------------------------------
// OpenAI client secret endpoint. Used by "current" only (confirmed, today's flow).
export const OPENAI_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

// GPT-Live-1 does NOT hand out browser session passes (client secrets). Per OpenAI's GPT-Live WebRTC guide
// (developers.openai.com/api/docs/guides/voice-webrtc?api=live) the server relays the connection: the app sends
// its WebRTC offer (SDP) to us, we POST it with the server key to OpenAI's live sessions address as JSON
// { session, transport: { type: "webrtc", sdp } }, and OpenAI answers (201) with JSON { session: { id },
// transport: { sdp } }. We return only the SDP answer and the opaque session id; the key never leaves the server.
// Confirmed from the guide: path /v1/live/sessions, JSON body with session + transport, answer in transport.sdp.
// UNCONFIRMED (guide text only partly readable): host api.openai.com (same as the WebSocket address on the model
// page), Bearer auth like every OpenAI API call, top-level function tools in the live session, no voice field
// (the guide sets none, so the default voice is used). Each is one line here.
export const GPT_LIVE_MODEL = "gpt-live-1";
export const GPT_LIVE_SESSIONS_URL = "https://api.openai.com/v1/live/sessions";
export const GPT_LIVE_SEND_NAV_TOOLS = true;
export function buildGptLiveSession(instructions: string) {
  const session: Record<string, unknown> = { model: GPT_LIVE_MODEL, instructions };
  // the 2 navigation tools only: no look-ups, so voices compare fairly
  if (GPT_LIVE_SEND_NAV_TOOLS) session.tools = DISCOVER_NAVIGATION_TOOLS;
  return session;
}
export function buildGptLiveRelayBody(instructions: string, sdpOffer: string) {
  return { session: buildGptLiveSession(instructions), transport: { type: "webrtc", sdp: sdpOffer } };
}
// A WebRTC offer is plain text starting "v=0". Kept small so the relay cannot be used to push large bodies.
export const MAX_SDP_BYTES = 12000;
export function validSdp(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("v=0") &&
    new TextEncoder().encode(value).byteLength <= MAX_SDP_BYTES;
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
  req: { contender: Letter; mode: VoiceMode; reveal: boolean; sdp?: string },
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

  if (which === "gpt-live-1") {
    // Server relay: the app must send its WebRTC offer; we forward it and return only the answer.
    if (!req.sdp) return { status: 400, body: { error: "This contender needs a connection offer.", needsOffer: true } };
    let res: Response;
    try {
      res = await fetchImpl(GPT_LIVE_SESSIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.openAiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildGptLiveRelayBody(built.session.instructions, req.sdp)),
      });
    } catch {
      return { status: 502, body: { error: COULD_NOT_START, status: 0 } };
    }
    if (!res.ok) return { status: 502, body: { error: COULD_NOT_START, status: res.status } };
    let payload: { session?: { id?: unknown }; transport?: { sdp?: unknown } } = {};
    try { payload = await res.json(); } catch { /* handled below */ }
    const answer = payload?.transport?.sdp;
    const sessionId = payload?.session?.id;
    if (typeof answer !== "string" || !answer.startsWith("v=0")) {
      return { status: 502, body: { error: COULD_NOT_START, status: res.status } };
    }
    const body: Record<string, unknown> = {
      contender: req.contender, provider: "openai_live", transport: "webrtc_relay", sdpAnswer: answer,
    };
    if (typeof sessionId === "string" && sessionId) body.sessionId = sessionId;
    if (req.reveal) body.model = GPT_LIVE_MODEL;
    return { status: 200, body };
  }

  // "current": today's Marty, unchanged one-time pass flow.
  const session = built.session;
  let res: Response;
  try {
    res = await fetchImpl(OPENAI_CLIENT_SECRETS_URL, {
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
    connectHint: "realtime",
    voice: built.voice,
  };
  if (req.reveal) body.model = CURRENT_MODEL;
  return { status: 200, body };
}
