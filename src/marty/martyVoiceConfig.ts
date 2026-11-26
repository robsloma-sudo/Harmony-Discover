/**
 * What the Marty screen asks the voice server for. Pure so a test can prove the request body.
 * Rob's decision (25 Nov 2026, P-20261125-0216): always-on listening, replacing hold-to-talk.
 * The server field is "mode" with "hands_free" or "push_to_talk" (Discover backend PR #136).
 */
import type { VoiceEngine, VoiceMode } from '../voice/sessionContract';
import type { ScreenContext } from '../voice/screenContext';
import { MARTY_BOSTON_CONSENT_VERSION } from '../voice/martySullivanBoston';
import { martyAgeConfirmed } from './martyAge';

export const MARTY_REQUESTED_MODE: VoiceMode = 'hands_free';
/** Rob (P-20261126-0102): his ElevenLabs "Marty" voice first; the server decides and can switch back to OpenAI. */
export const MARTY_VOICE_ENGINES: readonly VoiceEngine[] = ['elevenlabs', 'openai'];

export function martySessionConfig(input: { supabaseUrl: string; accessToken: string; screenContext: ScreenContext | null }) {
  return {
    supabaseUrl: input.supabaseUrl,
    accessToken: input.accessToken,
    consentVersion: MARTY_BOSTON_CONSENT_VERSION,
    // Only true after this device answered Yes to "Are you 21 or older?" (P-20261125-2244).
    ageConfirmed: martyAgeConfirmed(),
    mode: MARTY_REQUESTED_MODE,
    // P-20261126-0102: this app can play Rob's ElevenLabs voice and today's OpenAI voice; the server picks.
    voiceEngines: MARTY_VOICE_ENGINES,
    screenContext: input.screenContext,
  };
}
