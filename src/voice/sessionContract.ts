/**
 * Provider-neutral contract for requesting a short-lived bartender voice session.
 * The app must never receive a Supabase service-role key or a permanent provider key.
 * This file defines/validates the response only; it does not call a backend.
 */
export interface VoiceSessionRequest {
  consentVersion: string;
  mode: 'push_to_talk' | 'hands_free';
}

export interface VoiceSessionGrant {
  sessionId: string;
  provider: 'openai_realtime' | 'other';
  ephemeralToken: string;
  expiresAt: string;
  transport: 'webrtc' | 'websocket';
  model: string;
  voice: string;
}

export type VoiceSessionValidation =
  | { ok: true; grant: VoiceSessionGrant }
  | { ok: false; reason: string };

export function validateVoiceSessionGrant(value: unknown, now = Date.now()): VoiceSessionValidation {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'Invalid session response.' };
  const v = value as Record<string, unknown>;
  const requiredStrings = ['sessionId', 'provider', 'ephemeralToken', 'expiresAt', 'transport', 'model', 'voice'];
  if (requiredStrings.some((key) => typeof v[key] !== 'string' || !(v[key] as string).trim())) {
    return { ok: false, reason: 'Voice session response is incomplete.' };
  }
  if (v.provider !== 'openai_realtime' && v.provider !== 'other') return { ok: false, reason: 'Unsupported voice provider.' };
  if (v.transport !== 'webrtc' && v.transport !== 'websocket') return { ok: false, reason: 'Unsupported voice transport.' };
  const expiry = Date.parse(v.expiresAt as string);
  if (!Number.isFinite(expiry) || expiry <= now) return { ok: false, reason: 'Voice session has expired.' };
  // Ephemeral credentials should be short-lived. Reject unexpectedly long grants.
  if (expiry - now > 15 * 60 * 1000) return { ok: false, reason: 'Voice session lifetime exceeds the allowed limit.' };
  return { ok: true, grant: v as unknown as VoiceSessionGrant };
}
