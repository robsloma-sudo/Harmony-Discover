/**
 * Option A face rig: every moving part of face L as one plain object. Pure (no React Native) so vitest covers it.
 * LiveFace turns a pose into the weights and moves of the face pieces (see rigLayout.ts).
 */
export type Mood = 'neutral' | 'annoyed' | 'sarcastic' | 'warm';

/** Mouth shapes cut from face L (assets/marty/rig/mouth-*.webp). Lips, jaw, chin and cheeks move together in each. */
export const MOUTH_SHAPES = ['press', 'teeth', 'ee', 'fv', 'pucker', 'round', 'open', 'wide'] as const;
export type MouthShape = typeof MOUTH_SHAPES[number];
export type MouthWeights = Record<MouthShape, number>;

export interface FacePose {
  /** Weight of each mouth shape, 0..1, summing to at most 1 (the rest is the closed photo mouth). */
  mouth: MouthWeights;
  /** Overall opening 0..1 (for tests and the fallback face). */
  jaw: number;
  /** Brows down and together 0..1. */
  scowl: number;
  /** Both brows up 0..1. */
  browUp: number;
  /** One brow up (sarcasm) 0..1. */
  browOne: number;
  /** Eyes narrowed 0..1. */
  squint: number;
  /** Lids shut for a blink 0..1. */
  blink: number;
  /** Head pitch for nods, -1 up .. 1 down. */
  nod: number;
  /** Head tilt in degrees. */
  tilt: number;
  /** Head turn -1..1 (small sideways shift). */
  turn: number;
  /** Breathing 0..1. */
  breath: number;
  /** Voice is audible right now. */
  talking: boolean;
  mood: Mood;
}

export function emptyMouth(): MouthWeights {
  return { press: 0, teeth: 0, ee: 0, fv: 0, pucker: 0, round: 0, open: 0, wide: 0 };
}

export function restPose(): FacePose {
  return { mouth: emptyMouth(), jaw: 0, scowl: 0, browUp: 0, browOne: 0, squint: 0, blink: 0, nod: 0, tilt: 0, turn: 0, breath: 0, talking: false, mood: 'neutral' };
}
