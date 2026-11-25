/**
 * Which face Marty shows, and how open his mouth is, from the voice session. Pure, tested.
 */
import type { MartyFaceState } from './faceTypes';
import type { TurnPhase } from '../voice/turnController';

export interface FaceInputs {
  /** A live voice session is connected. */
  connected: boolean;
  /** Getting ready (consent, microphone, connecting). */
  connecting: boolean;
  /** The session is always-on listening (the server granted hands_free). */
  handsFree: boolean;
  phase: TurnPhase;
}

export function faceStateFor({ connected, connecting, handsFree, phase }: FaceInputs): MartyFaceState {
  if (connecting) return 'thinking';
  if (!connected) return 'idle';
  if (phase === 'speaking') return 'talking';
  if (phase === 'thinking') return 'thinking';
  if (phase === 'talking') return 'listening';
  // Connected and quiet: always-on means he is listening; hold-to-talk means he is waiting.
  return handsFree ? 'listening' : 'idle';
}

/** The microphone is live only in these cases; the UI shows the "listening" sign exactly then. */
export function microphoneLive({ connected, handsFree, phase }: Pick<FaceInputs, 'connected' | 'handsFree' | 'phase'>): boolean {
  if (!connected) return false;
  return handsFree || phase === 'talking';
}

/** Words under the face. */
export function faceCaption(state: MartyFaceState, handsFree: boolean, connected: boolean): string {
  if (!connected) return state === 'thinking' ? 'Getting Marty ready…' : 'Marty is at the bar.';
  switch (state) {
    case 'talking': return handsFree ? 'Marty is talking · just talk to cut in' : 'Marty is talking';
    case 'thinking': return 'Marty is thinking…';
    case 'listening': return 'Listening';
    default: return 'Hold to talk';
  }
}

/**
 * Lip sync: voice loudness (RMS of the audio samples, 0..1) to mouth opening (0..1).
 * A small gate keeps the mouth shut on background hiss; loud speech opens it fully.
 * The mouth opens fast and closes a little slower so it does not flicker.
 */
export function mouthOpenFromLevel(rms: number, previous = 0): number {
  const level = Number.isFinite(rms) ? Math.max(0, rms) : 0;
  const GATE = 0.015;
  const FULL = 0.18;
  const target = level <= GATE ? 0 : Math.min(1, (level - GATE) / (FULL - GATE));
  const prev = Number.isFinite(previous) ? Math.min(1, Math.max(0, previous)) : 0;
  const next = target >= prev ? prev + (target - prev) * 0.75 : prev + (target - prev) * 0.45;
  return next < 0.02 ? 0 : Math.round(next * 100) / 100;
}

/** RMS of time-domain bytes from an AnalyserNode (128 = silence). */
export function rmsFromBytes(bytes: ArrayLike<number>): number {
  if (!bytes.length) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const v = (bytes[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / bytes.length);
}
