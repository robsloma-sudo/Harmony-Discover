/**
 * Marty without a sign-in (P-20261125-0148 part 2).
 *
 * Marty runs on the same private guest account Discover already uses for scanning
 * (ensureDiscoverSession → Supabase anonymous user). Consent and saved memories belong
 * to that guest account. Signing in with email today makes a different account and nothing
 * links the guest to it, so the wording only promises this device's guest account.
 */
import type { Session } from '@supabase/supabase-js';

import { ensureDiscoverSession, supabase } from '../services/supabase';
import { MARTY_BOSTON_CONSENT_VERSION } from './martySullivanBoston';

/** Returns the current session, or quietly starts the Discover guest session. Never asks anyone to sign in. */
export async function ensureMartySession(): Promise<Session> {
  return ensureDiscoverSession();
}

/** True when the session is a Discover guest (anonymous) account. */
export function isGuestSession(session: Pick<Session, 'user'> | null | undefined): boolean {
  return Boolean(session?.user && (session.user as { is_anonymous?: boolean }).is_anonymous);
}

/**
 * Records the person's explicit "Enable voice" tap as voice consent.
 * Only the voice fields are written, so an existing memory choice is left as it was.
 */
export async function grantMartyVoiceConsent(userId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('bartender_voice_consents').upsert({
    user_id: userId,
    voice_enabled: true,
    voice_consent_version: MARTY_BOSTON_CONSENT_VERSION,
    voice_granted_at: now,
    voice_withdrawn_at: null,
    updated_at: now,
  }, { onConflict: 'user_id' });
  if (error) throw new Error('Could not save your voice choice. Please try again.');
}

/** Honest one-line note on where consent and memories live. */
/**
 * P-20261126-0102 round 2: guest-facing line naming the voice companies. Since Marty can run on Rob's
 * ElevenLabs voice (server picks; OpenAI is the fallback), both must be named before the first chat.
 */
export const MARTY_VOICE_PARTNERS_NOTE =
  'To hear and answer you, Marty runs on our voice partners ElevenLabs and OpenAI. While you talk to him, what you say or type, the screen you are on and any memories you chose to save are sent to them for that conversation.';

export function martyAccountNote(session: Pick<Session, 'user'> | null | undefined): string {
  return isGuestSession(session)
    ? 'No sign-in needed. Your choices and any memories you save are kept on this device’s private guest account. They stay with this guest account and do not move to an account you sign in to later.'
    : 'Your choices and any memories you save are private to your Discover account.';
}
