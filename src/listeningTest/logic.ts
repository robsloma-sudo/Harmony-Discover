/** Pure logic for the hidden listening test. No React Native, no services imports. */
export type Letter = 'A' | 'B' | 'C';
export const LETTERS: Letter[] = ['A', 'B', 'C'];
export const SCORES_KEY = 'discover.listeningTest.scores';

/** The same five lines for every contender. */
export const TEST_LINES: readonly { id: string; title: string; say: string }[] = [
  { id: 'recipe', title: 'Cocktail recipe', say: 'How do I make a proper Old Fashioned?' },
  { id: 'bottle', title: 'Bottle question', say: 'What is a good rye for a Manhattan that will not cost me a fortune?' },
  { id: 'banter', title: 'Banter', say: 'Tell me a joke about the Red Sox, and make it a good one.' },
  { id: 'interrupt', title: 'Interruption', say: 'Ask for a long story about Boston bars, then talk over him: "Hold on, just tell me the short version."' },
  { id: 'pairing', title: 'Pairing', say: 'What would go well with a Negroni and a plate of fried clams?' },
];

/** Score 1-5, or 'failed' when the contender could not start. */
export type Score = number | 'failed';
export type Scores = Partial<Record<Letter, Score>>;

export function isValidScore(v: unknown): v is Score {
  return v === 'failed' || (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5);
}

export function sanitizeScores(raw: unknown): Scores {
  const out: Scores = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const l of LETTERS) {
    const v = (raw as Record<string, unknown>)[l];
    if (isValidScore(v)) out[l] = v;
  }
  return out;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try { return (globalThis as { localStorage?: StorageLike }).localStorage ?? null; } catch { return null; }
}

export function loadScores(storage: StorageLike | null = defaultStorage()): Scores {
  try {
    const text = storage?.getItem(SCORES_KEY);
    return text ? sanitizeScores(JSON.parse(text)) : {};
  } catch { return {}; }
}

/** Returns true when saved; false when storage is missing or throws (the test still works). */
export function saveScores(scores: Scores, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SCORES_KEY, JSON.stringify(sanitizeScores(scores)));
    return true;
  } catch { return false; }
}

/** Reveal is allowed only when every letter has a score or is marked "could not start". */
export function revealEnabled(scores: Scores): boolean {
  return LETTERS.every(l => isValidScore(scores[l]));
}

/** Which voice the listening test asks for (P-20261126-0004). Same Marty brain and character book; only the voice differs. */
export type VoicePick = 'current' | 'elevenlabs';
export const VOICE_PICKS: readonly { id: VoicePick; label: string }[] = [
  { id: 'current', label: 'Current voice' },
  { id: 'elevenlabs', label: 'ElevenLabs voice' },
];
export const DEFAULT_VOICE: VoicePick = 'current';
export function isVoicePick(v: unknown): v is VoicePick { return v === 'current' || v === 'elevenlabs'; }

/** Plain text shown when the server says the ElevenLabs key is missing. */
export const ELEVENLABS_KEY_MISSING = 'ElevenLabs key not set.';
export function isElevenLabsKeyMissing(text: unknown): boolean {
  return typeof text === 'string' && /elevenlabs[\s_-]*key[\s_-]*not[\s_-]*set/i.test(text);
}

export type LetterState = 'idle' | 'connecting' | 'listening' | 'failed';

/** One-line failure text; includes the server status where given. */
export function failureMessage(letter: Letter, status?: number): string {
  if (status === 503) return `${letter} is not set up yet.`;
  return status ? `${letter} could not start (provider said ${status})` : `${letter} could not start.`;
}

/** Shown when a contender's connection still needs a server change (GPT-Live relay). Neutral: names no model. */
export function notWiredMessage(letter: Letter): string {
  return `${letter} needs a server change before it can connect.`;
}

export const TOOL_UNAVAILABLE_OUTPUT = '{"status":"unavailable","note":"listening test"}';

export type ConnectHint = 'realtime' | 'live';

/** Events to send when a contender calls a function. Realtime needs response.create; live is server-driven. */
export function functionCallAnswerEvents(hint: ConnectHint, callId: string, output: string = TOOL_UNAVAILABLE_OUTPUT): object[] {
  const item = { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } };
  return hint === 'realtime' ? [item, { type: 'response.create' }] : [item];
}

/** Float samples (-1..1) to little-endian PCM16 bytes. */
export function floatToPcm16(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return out;
}

export function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const n = Math.floor(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = view.getInt16(i * 2, true); out[i] = v < 0 ? v / 0x8000 : v / 0x7fff; }
  return out;
}

/** Linear-interpolation resample (mic rate to 16 kHz). */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const n = Math.max(1, Math.floor(input.length * toRate / fromRate));
  const out = new Float32Array(n);
  const ratio = fromRate / toRate;
  for (let i = 0; i < n; i++) {
    const pos = i * ratio; const i0 = Math.floor(pos); const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0);
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function geminiAudioMessage(pcm16: Uint8Array): string {
  return JSON.stringify({ realtimeInput: { audio: { data: bytesToBase64(pcm16), mimeType: 'audio/pcm;rate=16000' } } });
}

/** Pulls audio chunks (base64) and flags out of one Gemini server message. */
/**
 * Gemini's model id, mirrored from the server's GEMINI_MODEL (discover-voice-compare). Google's reference marks
 * setup.model as required in the first message, so we send it rather than an empty setup. The token's constraints
 * still decide the rest of the setup.
 */
export const GEMINI_LIVE_MODEL = 'models/gemini-3.8-live';

/** The first (and only first) client message on a Gemini Live socket. */
export function geminiSetupMessage(model: string = GEMINI_LIVE_MODEL): string {
  return JSON.stringify({ setup: { model } });
}

export function parseGeminiMessage(data: unknown): { setupComplete: boolean; interrupted: boolean; audio: string[]; text: string[]; toolCalls: { id: string; name: string }[] } {
  const r = { setupComplete: false, interrupted: false, audio: [] as string[], text: [] as string[], toolCalls: [] as { id: string; name: string }[] };
  if (!data || typeof data !== 'object') return r;
  const d = data as Record<string, any>;
  if (d.setupComplete !== undefined) r.setupComplete = true;
  const sc = d.serverContent;
  if (sc?.interrupted) r.interrupted = true;
  const parts = sc?.modelTurn?.parts;
  if (Array.isArray(parts)) for (const p of parts) {
    if (typeof p?.inlineData?.data === 'string') r.audio.push(p.inlineData.data);
  }
  const calls = d.toolCall?.functionCalls;
  if (Array.isArray(calls)) for (const c of calls) if (typeof c?.id === 'string') r.toolCalls.push({ id: c.id, name: String(c.name ?? '') });
  return r;
}

export function geminiToolResponse(calls: { id: string; name: string }[]): string {
  return JSON.stringify({ toolResponse: { functionResponses: calls.map(c => ({ id: c.id, name: c.name, response: { status: 'unavailable', note: 'listening test' } })) } });
}
