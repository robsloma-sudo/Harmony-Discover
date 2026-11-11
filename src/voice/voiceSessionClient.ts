import {
  validateVoiceSessionGrant,
  type VoiceSessionGrant,
  type VoiceSessionRequest,
} from './sessionContract';

export interface VoiceSessionClientConfig {
  supabaseUrl: string;
  accessToken: string;
  consentVersion: string;
  fetchImpl?: typeof fetch;
}

export type VoiceSessionClientResult =
  | { ok: true; grant: VoiceSessionGrant }
  | { ok: false; status?: number; message: string };

/**
 * Requests a short-lived voice grant from the Discover DEV Edge Function.
 * The caller must obtain microphone permission and explicit voice consent first.
 * No provider secret is accepted or stored by this client.
 */
export async function requestVoiceSession(
  config: VoiceSessionClientConfig,
): Promise<VoiceSessionClientResult> {
  if (!config.accessToken.trim()) return { ok: false, message: 'Sign in before starting voice.' };
  if (!config.consentVersion.trim()) return { ok: false, message: 'Voice consent is required.' };

  const baseUrl = config.supabaseUrl.replace(/\/+$/, '');
  if (baseUrl !== 'https://lqqmwqrffelgnbngrkep.supabase.co') {
    return { ok: false, message: 'Discover backend URL is invalid.' };
  }

  const request: VoiceSessionRequest = {
    consentVersion: config.consentVersion,
    mode: 'push_to_talk',
  };

  try {
    const response = await (config.fetchImpl ?? fetch)(
      `${baseUrl}/functions/v1/discover-voice-session`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      },
    );

    if (!response.ok) {
      const messages: Record<number, string> = {
        401: 'Your session expired. Please sign in again.',
        403: 'Voice access or consent was not approved.',
        429: 'Too many voice sessions. Please wait a moment.',
        503: 'The bartender is temporarily unavailable.',
      };
      return {
        ok: false,
        status: response.status,
        message: messages[response.status] ?? 'Could not start the voice session.',
      };
    }

    const payload: unknown = await response.json();
    const validation = validateVoiceSessionGrant(payload);
    if (!validation.ok) return { ok: false, message: validation.reason };
    return { ok: true, grant: validation.grant };
  } catch {
    // Never include auth tokens, request bodies, or raw provider errors in UI/log output.
    return { ok: false, message: 'Network connection failed. The camera is still available.' };
  }
}
