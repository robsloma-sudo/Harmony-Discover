import { describe, expect, it, vi } from 'vitest';
import { requestVoiceSession } from '../src/voice/voiceSessionClient';

const validGrant = {
  sessionId: 'session-123',
  provider: 'openai_realtime',
  ephemeralToken: 'ephemeral-only',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  transport: 'webrtc',
  model: 'realtime-model',
  voice: 'approved-voice',
};

describe('requestVoiceSession', () => {
  it('does not call the network without an access token', async () => {
    const fetchImpl = vi.fn();
    const result = await requestVoiceSession({
      supabaseUrl: 'https://discover-test.supabase.co',
      accessToken: '',
      consentVersion: 'voice-consent-v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends an authenticated push-to-talk request and validates the grant', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => validGrant,
    });
    const result = await requestVoiceSession({
      supabaseUrl: 'https://discover-test.supabase.co',
      accessToken: 'user-access-token',
      consentVersion: 'voice-consent-v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://discover-test.supabase.co/functions/v1/discover-voice-session',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects a production or non-Supabase URL before making a request', async () => {
    const fetchImpl = vi.fn();
    const result = await requestVoiceSession({
      supabaseUrl: 'https://example.com',
      accessToken: 'user-access-token',
      consentVersion: 'voice-consent-v1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
