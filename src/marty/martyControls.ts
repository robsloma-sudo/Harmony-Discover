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
