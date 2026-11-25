import { MARTY_BOSTON_CONSENT_VERSION } from "./martySullivanBoston.ts";
import { sanitizeScreenContext, type ScreenContext } from "./screenContext.ts";
import { LOOKUP_TOOL_NAMES, type LookupToolName } from "./lookupContract.ts";
import type { VoiceMode } from "./realtimeSession.ts";
import { AGE_CHECK_FIELD, validAgeField } from "./ageCheck.ts";

export const MAX_REQUEST_BYTES = 8192;
const ALLOWED_KEYS = new Set(["consentVersion", "mode", "screenContext", AGE_CHECK_FIELD]);

export type VoiceRequestResult =
  | { ok: true; mode: VoiceMode; screenContext: ScreenContext | null; ageConfirmed: boolean }
  | { ok: false };

export function parseVoiceRequest(input: unknown): VoiceRequestResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false };
  const body = input as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.some((k) => !ALLOWED_KEYS.has(k))) return { ok: false };
  if (body.consentVersion !== MARTY_BOSTON_CONSENT_VERSION) return { ok: false };
  if (body.mode !== "push_to_talk" && body.mode !== "hands_free") return { ok: false };
  if (!validAgeField(body[AGE_CHECK_FIELD])) return { ok: false };
  return {
    ok: true, mode: body.mode, screenContext: sanitizeScreenContext(body.screenContext),
    ageConfirmed: body[AGE_CHECK_FIELD] === true,
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
