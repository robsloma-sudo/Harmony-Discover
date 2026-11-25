/**
 * Marty 21+ check (P-20261125-2244 part 1, Rob: "Before Marty can start, the guest confirms they
 * are 21 or older (one simple screen, remembered on that device; if they say no, Marty stays off).").
 *
 * - null  = not asked yet on this device: show the question before anything else.
 * - 'yes' = remembered; never asked again on this device. Every voice start sends age_confirmed: true.
 * - 'no'  = Marty stays off (no voice session) with a friendly note; they can change it from the same place.
 *
 * Pure module (no React, no React Native) so it can be unit tested. Remembered in this device's
 * storage, like the Marty on/off switch.
 */
export type MartyAgeAnswer = 'yes' | 'no' | null;
export type MartyAgeStep = 'ask' | 'declined' | 'confirmed';

export const MARTY_AGE_KEY = 'discover.marty.age21';

interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem?(key: string): void }

function store(): KeyValueStore | null {
  try { return (globalThis as { localStorage?: KeyValueStore }).localStorage ?? null; } catch { return null; }
}

function readAnswer(): MartyAgeAnswer {
  try {
    const v = store()?.getItem(MARTY_AGE_KEY);
    return v === 'yes' || v === 'no' ? v : null;
  } catch { return null; }
}

let answer: MartyAgeAnswer = readAnswer();
const listeners = new Set<(a: MartyAgeAnswer) => void>();

export function getMartyAgeAnswer(): MartyAgeAnswer { return answer; }

/** True only after this device answered Yes. The voice start refuses to run without it. */
export function martyAgeConfirmed(): boolean { return answer === 'yes'; }

export function martyAgeStep(a: MartyAgeAnswer = answer): MartyAgeStep {
  return a === 'yes' ? 'confirmed' : a === 'no' ? 'declined' : 'ask';
}

export function subscribeMartyAge(listener: (a: MartyAgeAnswer) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Yes / No on the question. null = "Change my answer" (ask again). */
export function setMartyAgeAnswer(next: MartyAgeAnswer): void {
  try {
    const s = store();
    if (next) s?.setItem(MARTY_AGE_KEY, next);
    else if (s?.removeItem) s.removeItem(MARTY_AGE_KEY);
    else s?.setItem(MARTY_AGE_KEY, '');
  } catch { /* private mode: remembered for this visit only */ }
  if (next === answer) return;
  answer = next;
  for (const l of [...listeners]) l(answer);
}

/** Tests only: re-read storage as if the app had just started. */
export function _reloadMartyAgeFromStorage(): void { listeners.clear(); answer = readAnswer(); }
