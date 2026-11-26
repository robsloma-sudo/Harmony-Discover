/**
 * Mouth shapes from Marty's voice. Pure, tested.
 * - From the audio alone: loudness opens the jaw; where the sound energy sits (low = oo/oh, high = ee, hiss = s/sh)
 *   picks the lip shape; short dips inside a phrase press the lips (m, b, p).
 * - From words with timing (browser speech voice today, the voice service's own timing later): letters to shapes.
 */
import { emptyMouth, type MouthShape, type MouthWeights } from './facePose';

export interface AudioFeatures {
  /** Loudness, RMS of the samples (0..1). */
  rms: number;
  /** Share of energy 80-500 Hz (deep vowels, oo/oh). */
  low: number;
  /** Share 500-1100 Hz (open vowels, ah). */
  mid: number;
  /** Share 1100-3500 Hz (ee, eh). */
  high: number;
  /** Share 4000-8000 Hz (s, sh, f). */
  hiss: number;
}

const BANDS: Array<[keyof Omit<AudioFeatures, 'rms'>, number, number]> = [['low', 80, 500], ['mid', 500, 1100], ['high', 1100, 3500], ['hiss', 4000, 8000]];

/** Features from an AnalyserNode's byte frequency data (0..255 per bin) and time data (128 = silence). */
export function featuresFrom(freq: ArrayLike<number>, time: ArrayLike<number>, sampleRate: number, fftSize: number): AudioFeatures {
  let sum = 0;
  for (let i = 0; i < time.length; i += 1) { const v = (time[i] - 128) / 128; sum += v * v; }
  const rms = time.length ? Math.sqrt(sum / time.length) : 0;
  const binHz = sampleRate / fftSize;
  const e = { low: 0, mid: 0, high: 0, hiss: 0 };
  for (const [k, lo, hi] of BANDS) {
    const a = Math.max(0, Math.floor(lo / binHz)); const b = Math.min(freq.length - 1, Math.ceil(hi / binHz));
    let s = 0;
    for (let i = a; i <= b; i += 1) { const m = freq[i] / 255; s += m * m; }
    e[k] = s;
  }
  const total = e.low + e.mid + e.high + e.hiss;
  if (total <= 1e-9) return { rms, low: 0, mid: 0, high: 0, hiss: 0 };
  return { rms, low: e.low / total, mid: e.mid / total, high: e.high / total, hiss: e.hiss / total };
}

export const GATE = 0.012;
export const FULL = 0.16;

/** Loudness to opening 0..1 (gate keeps the mouth shut on hiss; loud speech opens it fully). */
export function openingFromRms(rms: number): number {
  const r = Number.isFinite(rms) ? Math.max(0, rms) : 0;
  if (r <= GATE) return 0;
  return Math.min(1, Math.pow((r - GATE) / (FULL - GATE), 0.8));
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Target mouth weights for one audio frame. `pressing` = a short dip inside a phrase (lips meet). */
export function mouthFromAudio(f: AudioFeatures, pressing = false): MouthWeights {
  const w = emptyMouth();
  const j = openingFromRms(f.rms);
  if (j === 0) { if (pressing) w.press = 0.75; return w; }
  // Opening ladder: teeth (small) -> open -> wide.
  if (j < 0.3) w.teeth = j / 0.3;
  else if (j < 0.65) { const t = (j - 0.3) / 0.35; w.teeth = 1 - t; w.open = t; }
  else { const t = Math.min(1, (j - 0.65) / 0.35); w.open = 1 - t; w.wide = t; }
  // Lip shape from where the energy sits.
  const hissy = clamp01((f.hiss - 0.3) / 0.3);
  const round = clamp01((f.low - 0.55) / 0.25) * (1 - clamp01((f.high - 0.25) / 0.2));
  const ee = clamp01((f.high - 0.3) / 0.3) * (1 - round);
  const move = (from: MouthShape, to: MouthShape, k: number) => { const m = w[from] * k; w[from] -= m; w[to] += m; };
  move('open', 'round', round); move('wide', 'round', round * 0.8); move('teeth', 'pucker', round);
  move('teeth', 'ee', ee); move('open', 'ee', ee * 0.5);
  // Hiss (s, sh, f): mostly teeth, barely open.
  for (const k of ['open', 'wide', 'round', 'pucker', 'ee'] as MouthShape[]) move(k, 'teeth', hissy * 0.8);
  return normalise(w);
}

export function normalise(w: MouthWeights): MouthWeights {
  let s = 0;
  for (const k in w) { const v = clamp01(w[k as MouthShape]); w[k as MouthShape] = v; s += v; }
  if (s > 1) for (const k in w) w[k as MouthShape] /= s;
  return w;
}

export function jawFromMouth(w: MouthWeights): number {
  return clamp01(w.teeth * 0.25 + w.ee * 0.22 + w.fv * 0.05 + w.pucker * 0.25 + w.round * 0.55 + w.open * 0.6 + w.wide * 1);
}

// ---------------------------------------------------------------------------------------------------------------
// Words to shapes (used with word timing).

export interface VisemeKey { at: number; shape: MouthShape | 'rest'; amount: number }

const VOWEL: Record<string, [MouthShape, number]> = {
  a: ['open', 0.95], e: ['ee', 0.85], i: ['ee', 0.9], o: ['round', 0.95], u: ['pucker', 0.9], y: ['ee', 0.7],
};

/** Letters of one word to shapes spread over its duration (ms). Digraphs first; silent trailing e dropped. */
export function visemesForWord(word: string, startMs: number, durationMs: number, loud = 1): VisemeKey[] {
  const w = word.toLowerCase().replace(/[^a-z']/g, '').replace(/e$/, (m, i: number) => (i > 2 ? '' : m));
  if (!w) return [];
  const units: Array<[MouthShape, number]> = [];
  for (let i = 0; i < w.length; i += 1) {
    const c = w[i]; const d = w.slice(i, i + 2);
    if (d === 'th' || d === 'sh' || d === 'ch') { units.push(['teeth', 0.8]); i += 1; continue; }
    if (d === 'oo' || d === 'ou' || d === 'ow') { units.push(['pucker', 0.95]); i += 1; continue; }
    if (d === 'ee' || d === 'ea') { units.push(['ee', 0.95]); i += 1; continue; }
    if (d === 'ai' || d === 'ay') { units.push(['open', 0.8]); units.push(['ee', 0.7]); i += 1; continue; }
    if (c === "'") continue;
    if (VOWEL[c]) { units.push(VOWEL[c]); continue; }
    if ('mbp'.includes(c)) { units.push(['press', 1]); continue; }
    if ('fv'.includes(c)) { units.push(['fv', 1]); continue; }
    if (c === 'w' || c === 'q') { units.push(['pucker', 0.85]); continue; }
    if (c === 'r') { units.push(['round', 0.5]); continue; }
    if (c === 'l') { units.push(['open', 0.5]); continue; }
    units.push(['teeth', 0.6]); // s z t d n k g c j x h
  }
  // Collapse repeats so double letters do not stutter.
  const merged = units.filter((u, i) => i === 0 || u[0] !== units[i - 1][0]);
  const vowels = merged.filter(u => ['open', 'ee', 'round', 'pucker', 'wide'].includes(u[0])).length || 1;
  // Vowels take longer than consonants.
  const weight = (u: [MouthShape, number]) => (['open', 'ee', 'round', 'pucker', 'wide'].includes(u[0]) ? 2.2 : 1);
  const total = merged.reduce((s, u) => s + weight(u), 0);
  let t = startMs;
  const keys: VisemeKey[] = [];
  for (const u of merged) {
    const shape = u[0] === 'open' && loud > 1.15 && vowels > 0 ? 'wide' : u[0];
    keys.push({ at: Math.round(t), shape, amount: Math.min(1, u[1] * loud) });
    t += (durationMs * weight(u)) / total;
  }
  return keys;
}

/** Rough speaking time for a word (ms) when no timing is given. */
export function wordDurationMs(word: string): number {
  const n = word.replace(/[^a-z]/gi, '').length;
  return Math.max(140, Math.min(650, 70 * n + 60));
}

/** A whole line to keys, with pauses at commas and full stops. Returns keys and total length. */
export function scriptFromText(text: string, startMs = 0): { keys: VisemeKey[]; endMs: number; words: Array<{ word: string; at: number; ms: number }> } {
  const keys: VisemeKey[] = []; const words: Array<{ word: string; at: number; ms: number }> = [];
  let t = startMs;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const loud = /[A-Z]{2,}|!/.test(raw) ? 1.25 : 1;
    const ms = wordDurationMs(raw);
    words.push({ word: raw, at: t, ms });
    keys.push(...visemesForWord(raw, t, ms, loud));
    t += ms;
    keys.push({ at: Math.round(t), shape: 'rest', amount: 0 });
    t += /[.!?]$/.test(raw) ? 380 : /[,;:]$/.test(raw) ? 200 : 40;
  }
  return { keys, endMs: t, words };
}

/** Weights at time t from a key list: holds the latest key, eased in over `ease` ms from the previous one. */
export function mouthAt(keys: VisemeKey[], t: number, ease = 70): MouthWeights {
  const w = emptyMouth();
  let i = -1;
  for (let k = 0; k < keys.length && keys[k].at <= t; k += 1) i = k;
  if (i < 0) return w;
  const cur = keys[i];
  const k = Math.min(1, (t - cur.at) / ease);
  const prev = i > 0 ? keys[i - 1] : null;
  if (cur.shape !== 'rest') w[cur.shape] += cur.amount * k;
  if (prev && prev.shape !== 'rest' && k < 1) w[prev.shape] += prev.amount * (1 - k);
  return normalise(w);
}
