import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsert = vi.fn();
const from = vi.fn((_table: string) => ({ upsert }));
const ensureDiscoverSession = vi.fn();

vi.mock('../src/services/supabase', () => ({
  supabase: { from: (table: string) => from(table) },
  ensureDiscoverSession: () => ensureDiscoverSession(),
}));
vi.mock('../src/voice/martySullivanBoston', () => ({ MARTY_BOSTON_CONSENT_VERSION: 'marty-boston-consent-2026-11-10' }));

import { ensureMartySession, grantMartyVoiceConsent, isGuestSession, martyAccountNote } from '../src/voice/martyGuest';

describe('Marty without sign-in', () => {
  beforeEach(() => { upsert.mockReset(); from.mockClear(); ensureDiscoverSession.mockReset(); });

  it('reuses the Discover guest session (same code as scanning)', async () => {
    const guest = { access_token: 'guest-token', user: { id: 'guest-1', is_anonymous: true } };
    ensureDiscoverSession.mockResolvedValue(guest);
    await expect(ensureMartySession()).resolves.toBe(guest);
    expect(ensureDiscoverSession).toHaveBeenCalledTimes(1);
  });

  it('passes on a clear message if guests cannot be started', async () => {
    ensureDiscoverSession.mockRejectedValue(new Error('Public scanning is not enabled yet.'));
    await expect(ensureMartySession()).rejects.toThrow('Public scanning is not enabled yet.');
  });

  it('Enable voice writes only the voice consent fields, leaving memory alone', async () => {
    upsert.mockResolvedValue({ error: null });
    await grantMartyVoiceConsent('guest-1');
    expect(from).toHaveBeenCalledWith('bartender_voice_consents');
    const [row, options] = upsert.mock.calls[0];
    expect(options).toEqual({ onConflict: 'user_id' });
    expect(row).toMatchObject({ user_id: 'guest-1', voice_enabled: true, voice_consent_version: 'marty-boston-consent-2026-11-10', voice_withdrawn_at: null });
    expect(Object.keys(row).some(k => k.startsWith('memory'))).toBe(false);
  });

  it('reports a failed consent save', async () => {
    upsert.mockResolvedValue({ error: { message: 'denied' } });
    await expect(grantMartyVoiceConsent('guest-1')).rejects.toThrow('Could not save your voice choice');
  });

  it('wording is honest about where memories live', () => {
    expect(isGuestSession({ user: { is_anonymous: true } } as never)).toBe(true);
    expect(isGuestSession({ user: { is_anonymous: false } } as never)).toBe(false);
    expect(isGuestSession(null)).toBe(false);
    expect(martyAccountNote({ user: { is_anonymous: true } } as never)).toMatch(/this device’s private guest account/);
    expect(martyAccountNote({ user: { is_anonymous: true } } as never)).not.toMatch(/signing in later keeps/);
    expect(martyAccountNote({ user: { is_anonymous: false } } as never)).toMatch(/private to your Discover account/);
  });
});
