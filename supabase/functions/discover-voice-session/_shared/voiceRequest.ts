import { MARTY_BOSTON_CONSENT_VERSION } from "./martySullivanBoston.ts";
import { sanitizeScreenContext, type ScreenContext } from "./screenContext.ts";
import { LOOKUP_TOOL_NAMES, type LookupToolName } from "./lookupContract.ts";
import type { VoiceMode } from "./realtimeSession.ts";
import { AGE_CHECK_FIELD, validAgeField } from "./ageCheck.ts";
import { ELEVEN_CONNECTIONS, VOICE_ENGINES, type ElevenConnection, type VoiceEngine } from "./elevenlabs.ts";

export const MAX_REQUEST_BYTES = 8192;
// voiceEngines / elevenLabsConnection (P-20261126-0102): optional, sent only by new app copies that can play
// ElevenLabs. Absent = an old app copy = exactly today's OpenAI grant.
const ALLOWED_KEYS = new Set(["consentVersion", "mode", "screenContext", AGE_CHECK_FIELD, "voiceEngines", "elevenLabsConnection"]);

export type VoiceRequestResult =
  | {
    ok: true; mode: VoiceMode; screenContext: ScreenContext | null; ageConfirmed: boolean;
    voiceEngines: VoiceEngine[] | null; elevenLabsConnection: ElevenConnection;
  }
  | { ok: false };

function validEngines(v: unknown): boolean {
  if (v === undefined) return true;
  if (!Array.isArray(v) || v.length < 1 || v.length > VOICE_ENGINES.length) return false;
  return v.every((e) => typeof e === "string" && VOICE_ENGINES.includes(e)) && new Set(v).size === v.length;
}

export function parseVoiceRequest(input: unknown): VoiceRequestResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false };
  const body = input as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.some((k) => !ALLOWED_KEYS.has(k))) return { ok: false };
  if (body.consentVersion !== MARTY_BOSTON_CONSENT_VERSION) return { ok: false };
  if (body.mode !== "push_to_talk" && body.mode !== "hands_free") return { ok: false };
  if (!validAgeField(body[AGE_CHECK_FIELD])) return { ok: false };
  if (!validEngines(body.voiceEngines)) return { ok: false };
  const conn = body.elevenLabsConnection;
  if (conn !== undefined && (typeof conn !== "string" || !ELEVEN_CONNECTIONS.includes(conn))) return { ok: false };
  return {
    ok: true, mode: body.mode, screenContext: sanitizeScreenContext(body.screenContext),
    ageConfirmed: body[AGE_CHECK_FIELD] === true,
    voiceEngines: body.voiceEngines === undefined ? null : body.voiceEngines as VoiceEngine[],
    elevenLabsConnection: conn === "websocket" ? "websocket" : "webrtc",
  };
}

// Second request kind: a look-up Marty asked for. Keys are exactly action, tool, arguments.
export const MAX_LOOKUP_ARGUMENTS_CHARS = 2000;
const LOOKUP_KEYS = new Set(["action", "tool", "arguments"]);

export type LookupRequestResult =
  | { ok: true; tool: LookupToolName; args: unknown }
  | { ok: false };

export function parseLookupRequest(input: unknown): LookupRequestResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false };
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((k) => !LOOKUP_KEYS.has(k))) return { ok: false };
  if (body.action !== "lookup") return { ok: false };
  if (typeof body.tool !== "string" || !(LOOKUP_TOOL_NAMES as readonly string[]).includes(body.tool)) return { ok: false };
  let args = body.arguments === undefined ? {} : body.arguments;
  if (typeof args === "string") {
    if (args.length > MAX_LOOKUP_ARGUMENTS_CHARS) return { ok: false };
    try { args = JSON.parse(args); } catch { return { ok: false }; }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false };
  return { ok: true, tool: body.tool as LookupToolName, args };
}
