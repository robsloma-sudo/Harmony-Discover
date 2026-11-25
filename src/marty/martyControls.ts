/**
 * Small, pure rules for Marty's controls (P-20261125-0216, CEO notes 25 Nov):
 * - one clear Stop that closes the microphone and ends the session at once;
 * - hold-to-talk only as the hidden fallback (when the server grants push_to_talk);
 * - a long press never selects button text (web), so holding a button feels like a button.
 */
export function showStopButton(v: { connected: boolean; busy: boolean }): boolean {
  // Visible while connecting too, so Stop also cancels a session that is still starting.
  return v.connected || v.busy;
}

export function showHoldToTalk(v: { connected: boolean; handsFree: boolean }): boolean {
  // Never shown in always-on mode; only when the server fell back to push_to_talk.
  return v.connected && !v.handsFree;
}

/** Web-only style: no text selection, no iOS long-press callout. Inputs opt back in. */
export const NO_SELECT_WEB = {
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
} as const;

export const SELECT_TEXT_WEB = { userSelect: 'text', WebkitUserSelect: 'text' } as const;

/**
 * Opening Marty's face starts the session by itself once voice consent is already given
 * (carried over from #142): once per opening, never after Stop, never on the phone app.
 */
export function shouldAutoStart(v: { open: boolean; web: boolean; loadingConsent: boolean; consent: boolean; connected: boolean; busy: boolean; alreadyTried: boolean }): boolean {
  return v.open && v.web && !v.loadingConsent && v.consent && !v.connected && !v.busy && !v.alreadyTried;
}

/** Web-only: a right-click or long press on a Marty button never opens the browser menu. */
export const NO_MENU_WEB = { onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault() } as const;
