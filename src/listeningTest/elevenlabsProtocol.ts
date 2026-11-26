/**
 * Pure message helpers for the ElevenLabs Agents websocket (no browser, no React Native imports).
 * Server events read from ElevenLabs' client-events page (see the backend README "Option A").
 */
import { bytesToBase64 } from './logic';

export const DEFAULT_ELEVEN_OUTPUT_RATE = 16000;
export const ELEVEN_INPUT_RATE = 16000;

export type ElevenAlignment = { chars?: unknown; char_start_times_ms?: unknown; char_durations_ms?: unknown };

export type ElevenEvent =
  | { type: 'metadata'; outputRate: number; inputRate: number }
  | { type: 'audio'; base64: string; eventId: number | null; alignment: ElevenAlignment | null }
  | { type: 'agent_response'; text: string }
  | { type: 'user_transcript'; text: string }
  | { type: 'interruption'; eventId: number | null }
  | { type: 'ping'; eventId: number | null; pingMs: number }
  | { type: 'ignore' };

/** "pcm_16000" -> 16000; "pcm_24000" -> 24000. Anything else (ulaw_8000, junk) -> null. */
export function pcmRateFromFormat(format: unknown): number | null {
  if (typeof format !== 'string') return null;
  const m = /^pcm_(\d{4,6})$/.exec(format.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 8000 && n <= 96000 ? n : null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);

/** Parses one websocket text message. Never throws; unknown or malformed messages are { type: 'ignore' }. */
export function parseElevenMessage(raw: unknown): ElevenEvent {
  let data: Record<string, unknown> | null;
  try { data = obj(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { return { type: 'ignore' }; }
  if (!data) return { type: 'ignore' };
  switch (data.type) {
    case 'conversation_initiation_metadata': {
      const e = obj(data.conversation_initiation_metadata_event) ?? {};
      return {
        type: 'metadata',
        outputRate: pcmRateFromFormat(e.agent_output_audio_format) ?? DEFAULT_ELEVEN_OUTPUT_RATE,
        inputRate: pcmRateFromFormat(e.user_input_audio_format) ?? ELEVEN_INPUT_RATE,
      };
    }
    case 'audio': {
      const e = obj(data.audio_event);
      if (!e || typeof e.audio_base_64 !== 'string' || !e.audio_base_64) return { type: 'ignore' };
      return { type: 'audio', base64: e.audio_base_64, eventId: num(e.event_id), alignment: obj(e.alignment) as ElevenAlignment | null };
    }
    case 'agent_response': {
      const t = obj(data.agent_response_event)?.agent_response;
      return typeof t === 'string' && t ? { type: 'agent_response', text: t } : { type: 'ignore' };
    }
    case 'user_transcript': {
      const t = obj(data.user_transcription_event)?.user_transcript;
      return typeof t === 'string' && t ? { type: 'user_transcript', text: t } : { type: 'ignore' };
    }
    case 'interruption':
      return { type: 'interruption', eventId: num(obj(data.interruption_event)?.event_id) };
    case 'ping': {
      const e = obj(data.ping_event);
      return { type: 'ping', eventId: num(e?.event_id), pingMs: Math.max(0, num(e?.ping_ms) ?? 0) };
    }
    default:
      return { type: 'ignore' };
  }
}

export function pongMessage(eventId: number | null): string {
  return JSON.stringify({ type: 'pong', event_id: eventId });
}

/** Mic chunk (little-endian PCM16 bytes at the input rate) as the client message. */
export function userAudioChunkMessage(pcm16: Uint8Array): string {
  return JSON.stringify({ user_audio_chunk: bytesToBase64(pcm16) });
}

/** Little-endian PCM16 bytes to Int16Array (copying, so odd offsets are safe). */
export function bytesToInt16(bytes: Uint8Array): Int16Array {
  const n = Math.floor(bytes.length / 2);
  const out = new Int16Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

/** Int16 samples resampled by linear interpolation (used to hand the face service 16 kHz). */
export function resampleInt16(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate || input.length === 0) return input;
  const n = Math.max(1, Math.floor((input.length * toRate) / fromRate));
  const out = new Int16Array(n);
  const ratio = fromRate / toRate;
  for (let i = 0; i < n; i++) {
    const pos = i * ratio; const i0 = Math.floor(pos); const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = Math.round(input[i0] + (input[i1] - input[i0]) * (pos - i0));
  }
  return out;
}

/** Only wss:// addresses are opened. */
export function isSecureSocketUrl(url: unknown): url is string {
  return typeof url === 'string' && /^wss:\/\/[^\s]+$/.test(url);
}
