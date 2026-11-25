import { MARTY_BOSTON_CONSENT_VERSION } from "./martySullivanBoston.ts";
import { sanitizeScreenContext, type ScreenContext } from "./screenContext.ts";
import type { VoiceMode } from "./realtimeSession.ts";

export const MAX_REQUEST_BYTES = 8192;
const ALLOWED_KEYS = new Set(["consentVersion", "mode", "screenContext"]);

export type VoiceRequestResult =
  | { ok: true; mode: VoiceMode; screenContext: ScreenContext | null }
  | { ok: false };

/** Top-level body check. Unknown keys, wrong consent version or bad mode => not ok. Bad screenContext is ignored. */
export function parseVoiceRequest(input: unknown): VoiceRequestResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false };
  const body = input as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.some((k) => !ALLOWED_KEYS.has(k))) return { ok: false };
  if (body.consentVersion !== MARTY_BOSTON_CONSENT_VERSION) return { ok: false };
  if (body.mode !== "push_to_talk" && body.mode !== "hands_free") return { ok: false };
  return { ok: true, mode: body.mode, screenContext: sanitizeScreenContext(body.screenContext) };
}
