/**
 * Provider-neutral contract for requesting a short-lived bartender voice session.
 * The app must never receive a Supabase service-role key or a permanent provider key.
 * This file defines/validates the response only; it does not call a backend.
 */
import type { ScreenContext } from './screenContext';

export type VoiceMode = 'push_to_talk' | 'hands_free';

/** Request body for discover-voice-session (backend README, PR #131; age_confirmed from P-20261125-2244 part 2): exactly these keys. */
export interface VoiceSessionRequest {
  consentVersion: string;
  mode: VoiceMode;
  /** The guest confirmed 21 or older on this device (P-20261125-2244). Always true when sent. */
  age_confirmed: true;
  screenContext?: ScreenContext;
}

/** Today's OpenAI realtime voice (WebRTC, short-lived ephemeral key). */
export interface OpenAiVoiceGrant {
  sessionId: string;
  provider: 'openai_realtime' | 'other';
  ephemeralToken: string;
  expiresAt: string;
  transport: 'webrtc' | 'websocket';
  model: string;
  voice: string;
  /** The mode the server actually granted. hands_free only when the app asked for it. */
  mode: VoiceMode;
}

/**
 * Rob's ElevenLabs "Marty" voice (P-20261126-0102). The server picks the voice; the app only follows
 * the grant it gets back. One-conversation token for the official ElevenLabs browser kit, no API key.
 * The ElevenLabs agent does its own turn-taking, so this grant is always hands-free.
 */
export interface ElevenLabsVoiceGrant {
  sessionId: string;
  provider: 'elevenlabs_agents';
  conversationToken: string;
  expiresAt: string;
  transport: 'webrtc';
  model: string;
  voice: string;
  mode: 'hands_free';
}

export type VoiceSessionGrant = OpenAiVoiceGrant | ElevenLabsVoiceGrant;

export function isElevenLabsGrant(grant: VoiceSessionGrant): grant is ElevenLabsVoiceGrant {
  return grant.provider === 'elevenlabs_agents';
}

export type VoiceSessionValidation =
  | { ok: true; grant: VoiceSessionGrant }
  | { ok: false; reason: string };

/** OpenAI realtime client secrets are reusable until expiry, so keep their accepted lifetime tight. */
const OPENAI_MAX_LIFETIME_MS = 2 * 60 * 1000;
/** ElevenLabs conversation tokens are for one conversation and last up to 15 minutes. */
const ELEVENLABS_MAX_LIFETIME_MS = 15 * 60 * 1000;

function nonEmpty(v: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof v[key] === 'string' && (v[key] as string).trim().length > 0);
}

function checkExpiry(expiresAt: string, now: number, maxMs: number): string | null {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now) return 'Voice session has expired.';
  if (expiry - now > maxMs) return 'Voice session lifetime exceeds the allowed limit.';
  return null;
}

export function validateVoiceSessionGrant(value: unknown, now = Date.now()): VoiceSessionValidation {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'Invalid session response.' };
  const v = value as Record<string, unknown>;
  if (v.provider === 'elevenlabs_agents') {
    if (!nonEmpty(v, ['sessionId', 'conversationToken', 'expiresAt', 'voice'])) {
      return { ok: false, reason: 'Voice session response is incomplete.' };
    }
    if (v.transport !== undefined && v.transport !== 'webrtc') return { ok: false, reason: 'Unsupported voice transport.' };
    const expiryProblem = checkExpiry(v.expiresAt as string, now, ELEVENLABS_MAX_LIFETIME_MS);
    if (expiryProblem) return { ok: false, reason: expiryProblem };
    const grant: ElevenLabsVoiceGrant = {
      sessionId: v.sessionId as string,
      provider: 'elevenlabs_agents',
      conversationToken: v.conversationToken as string,
      expiresAt: v.expiresAt as string,
      transport: 'webrtc',
      model: typeof v.model === 'string' && v.model.trim() ? v.model : 'elevenlabs',
      voice: v.voice as string,
      mode: 'hands_free',
    };
    return { ok: true, grant };
  }
  const requiredStrings = ['sessionId', 'provider', 'ephemeralToken', 'expiresAt', 'transport', 'model', 'voice'];
  if (!nonEmpty(v, requiredStrings)) return { ok: false, reason: 'Voice session response is incomplete.' };
  if (v.provider !== 'openai_realtime' && v.provider !== 'other') return { ok: false, reason: 'Unsupported voice provider.' };
  if (v.transport !== 'webrtc' && v.transport !== 'websocket') return { ok: false, reason: 'Unsupported voice transport.' };
  // Older servers sent no mode; that was always push-to-talk.
  const mode = v.mode === undefined ? 'push_to_talk' : v.mode;
  if (mode !== 'push_to_talk' && mode !== 'hands_free') return { ok: false, reason: 'Unsupported voice mode.' };
  const expiryProblem = checkExpiry(v.expiresAt as string, now, OPENAI_MAX_LIFETIME_MS);
  if (expiryProblem) return { ok: false, reason: expiryProblem };
  return { ok: true, grant: { ...(v as unknown as OpenAiVoiceGrant), mode } };
}
