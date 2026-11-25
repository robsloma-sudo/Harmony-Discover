/**
 * Marty on the scanner (P-20261125-0216): one switch for the whole of Marty.
 *
 * - enabled: Marty's button shows on the scanner. Turning this off is the ONE off switch:
 *   it hides the button and the face, and every listener (the voice hook) must stop the
 *   microphone and his voice at once. The same switch is on the face and in Settings.
 * - open: the face sheet is up. Closing the sheet does not end the voice session; the
 *   button keeps a clear "listening" sign while the microphone is on.
 *
 * Pure module (no React, no React Native) so it can be unit tested. Remembered on this device.
 */
export interface MartyPresence {
  enabled: boolean;
  open: boolean;
}

export const MARTY_ENABLED_KEY = 'discover.marty';

type Listener = (state: MartyPresence) => void;

interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void }

function store(): KeyValueStore | null {
  try {
    const w = (globalThis as { localStorage?: KeyValueStore }).localStorage;
    return w ?? null;
  } catch { return null; }
}

function readEnabled(): boolean {
  try { return store()?.getItem(MARTY_ENABLED_KEY) !== 'off'; } catch { return true; }
}

let state: MartyPresence = { enabled: readEnabled(), open: false };
const listeners = new Set<Listener>();

function set(next: MartyPresence) {
  if (next.enabled === state.enabled && next.open === state.open) return;
  state = next;
  for (const l of [...listeners]) l(state);
}

export function getMartyPresence(): MartyPresence { return state; }

export function subscribeMartyPresence(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The Marty button (or the dock MARTY button): show the face. Also turns Marty back on. */
export function openMarty(): void {
  if (!state.enabled) setMartyEnabled(true);
  set({ enabled: true, open: true });
}

/** Slide the face down. Voice keeps running if it is on; the button shows that it is listening. */
export function closeMartyFace(): void { set({ ...state, open: false }); }

/** The one off switch (face and Settings). Off = no button, no face, no microphone, no voice. */
export function setMartyEnabled(enabled: boolean): void {
  try { store()?.setItem(MARTY_ENABLED_KEY, enabled ? 'on' : 'off'); } catch { /* private mode */ }
  set({ enabled, open: enabled ? state.open : false });
}

export function turnMartyOff(): void { setMartyEnabled(false); }

/** The Marty button shows only when Marty is on, his face is down and no other sheet covers the scanner. */
export function martyButtonVisible(p: MartyPresence, hidden: boolean): boolean {
  return p.enabled && !p.open && !hidden;
}

/**
 * Wire the off switch to whatever holds the microphone. `stopNow` is called synchronously the
 * moment Marty is turned off, so the microphone goes off before anything else happens.
 */
export function bindMartyOffSwitch(stopNow: () => void): () => void {
  return subscribeMartyPresence(p => { if (!p.enabled) stopNow(); });
}

/** Tests only. */
export function _resetMartyPresence(next?: Partial<MartyPresence>): void {
  listeners.clear();
  state = { enabled: readEnabled(), open: false, ...next };
}
