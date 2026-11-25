/**
 * What the Marty screen asks the voice server for. Pure so a test can prove the request body.
 * Rob's decision (25 Nov 2026, P-20261125-0216): always-on listening, replacing hold-to-talk.
 * The server field is "mode" with "hands_free" or "push_to_talk" (Discover backend PR #136).
 */
import type { VoiceMode } from '../voice/sessionContract';
import type { ScreenContext } from '../voice/screenContext';
import { MARTY_BOSTON_CONSENT_VERSION } from '../voice/martySullivanBoston';

export const MARTY_REQUESTED_MODE: VoiceMode = 'hands_free';

export function martySessionConfig(input: { supabaseUrl: string; accessToken: string; screenContext: ScreenContext | null }) {
  return {
    supabaseUrl: input.supabaseUrl,
    accessToken: input.accessToken,
    consentVersion: MARTY_BOSTON_CONSENT_VERSION,
    mode: MARTY_REQUESTED_MODE,
    screenContext: input.screenContext,
  };
}
