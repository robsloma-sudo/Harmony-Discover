/**
 * Marty's mood from his own words, and what each mood does to brows, eyes and head. Pure, tested.
 * TODO(P-20261126-0028 backend contract): if the voice server later sends a mood or emphasis tag with each reply,
 * feed it to FaceDriver.pushMood() and it wins over these word rules.
 */
import type { Mood } from './facePose';

const ANNOYED = /\b(no+|nope|not|never|don'?t|can'?t|won'?t|stop|seriously|ugh|listen|ridiculous|absolutely not|hate|wrong|terrible|crime|criminal|sacrilege|insult|please don'?t|come on|for the love of)\b/gi;
const SARCASTIC = /\b(oh,? (sure|great|wow|really|right|yes|look)|bold choice|of course|sure thing|wow|brilliant|genius|fantastic|how original|shocking|groundbreaking|living dangerously|real adventurous|pushing the boundaries|congratulations|good for you|huh)\b/gi;
const WARM = /\b(cheers|lovely|beautiful|good choice|great choice|nice one|love (it|that)|enjoy|my friend|now we'?re talking|that'?s the stuff|atta)\b/gi;

export interface MoodRead { mood: Mood; strength: number; question: boolean }

const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

/** Mood of the latest words of a reply (about the last two sentences). */
export function moodFromText(text: string): MoodRead {
  const tail = text.slice(-160);
  const a = count(ANNOYED, tail) + (tail.match(/!/g) ?? []).length * 0.5;
  const s = count(SARCASTIC, tail) * 1.4;
  const w = count(WARM, tail);
  const question = /\?\s*$/.test(tail.trim());
  const best = Math.max(a, s, w);
  if (best < 1) return { mood: 'neutral', strength: 0, question };
  const strength = Math.min(1, 0.55 + best * 0.2);
  if (s >= a && s >= w) return { mood: 'sarcastic', strength, question };
  if (a >= w) return { mood: 'annoyed', strength, question };
  return { mood: 'warm', strength, question };
}

export interface ExpressionTargets { scowl: number; browUp: number; browOne: number; squint: number; tilt: number; turn: number }

/** Resting looks. Marty is a gruff old bartender: a little scowl and squint even when calm. */
export function expressionFor(mood: Mood, strength: number, faceState: 'idle' | 'listening' | 'thinking' | 'talking'): ExpressionTargets {
  const k = Math.max(0, Math.min(1, strength));
  let t: ExpressionTargets = { scowl: 0.18, browUp: 0, browOne: 0, squint: 0.15, tilt: 0, turn: 0 };
  if (mood === 'annoyed') t = { scowl: 0.35 + 0.65 * k, browUp: 0, browOne: 0, squint: 0.35 + 0.55 * k, tilt: -1.2 * k, turn: 0 };
  if (mood === 'sarcastic') t = { scowl: 0.05, browUp: 0, browOne: 0.45 + 0.55 * k, squint: 0.25 + 0.2 * k, tilt: 3.2 * k, turn: 0.35 * k };
  if (mood === 'warm') t = { scowl: 0, browUp: 0.2 * k, browOne: 0, squint: 0.3 + 0.25 * k, tilt: 1.2 * k, turn: 0 };
  if (faceState === 'listening' && mood === 'neutral') t = { ...t, scowl: 0.08, browUp: 0.15, tilt: 1.5 };
  if (faceState === 'thinking') t = { ...t, squint: Math.max(t.squint, 0.35), tilt: -2.5, browOne: Math.max(t.browOne, 0.25) };
  return t;
}
