// P-20261125-2244 part 1 (Rob): "Before Marty can start, the guest confirms they are 21 or older
// (one simple screen, remembered on that device; if they say no, Marty stays off)."
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _reloadMartyAgeFromStorage, getMartyAgeAnswer, MARTY_AGE_KEY, martyAgeConfirmed, martyAgeStep, setMartyAgeAnswer,
} from '../src/marty/martyAge';
import { shouldAutoStart } from '../src/marty/martyControls';
import { martySessionConfig } from '../src/marty/martyVoiceConfig';
import { requestVoiceSession } from '../src/voice/voiceSessionClient';
import { VoiceSessionCoordinator } from '../src/voice/voiceSessionCoordinator';

const URL = 'https://lqqmwqrffelgnbngrkep.supabase.co';
class MemoryStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
let storage: MemoryStorage;

/** A brand-new device: empty storage, app just started. */
function freshDevice() { storage = new MemoryStorage(); vi.stubGlobal('localStorage', storage); _reloadMartyAgeFromStorage(); }
/** Close and reopen the app on the same device. */
function restartApp() { _reloadMartyAgeFromStorage(); }

function harness() {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return { ok: true, status: 200, json: async () => ({
      sessionId: 's', provider: 'openai_realtime', ephemeralToken: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(),
      transport: 'webrtc', model: 'm', voice: 'cedar', mode: 'hands_free',
    }) };
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const platform = { requestMicrophonePermission: vi.fn(async () => 'granted' as const), connect: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
  const coordinator = () => new VoiceSessionCoordinator({ ...martySessionConfig({ supabaseUrl: URL, accessToken: 'a', screenContext: null }), fetchImpl, platform, consentConfirmed: true });
  return { bodies, fetchImpl, platform, coordinator };
}

const autoBase = { open: true, web: true, loadingConsent: false, consent: true, connected: false, busy: false, alreadyTried: false };

beforeEach(() => { vi.unstubAllGlobals(); freshDevice(); });

describe('Marty 21+ question', () => {
  it('a fresh device sees the question before Marty can start', async () => {
    expect(getMartyAgeAnswer()).toBeNull();
    expect(martyAgeStep()).toBe('ask');
    expect(martyAgeConfirmed()).toBe(false);
    expect(shouldAutoStart({ ...autoBase, ageConfirmed: martyAgeConfirmed() })).toBe(false);
    const h = harness();
    const snap = await h.coordinator().start();
    expect(snap.voice.state).not.toBe('listening');
    expect(h.platform.requestMicrophonePermission).not.toHaveBeenCalled();
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it('No keeps Marty off: no microphone, no voice session, friendly note step', async () => {
    setMartyAgeAnswer('no');
    expect(martyAgeStep()).toBe('declined');
    expect(storage.getItem(MARTY_AGE_KEY)).toBe('no');
    const h = harness();
    const snap = await h.coordinator().start();
    expect(snap.error).toBe('Marty is only for guests 21 or older.');
    expect(h.platform.requestMicrophonePermission).not.toHaveBeenCalled();
    expect(h.platform.connect).not.toHaveBeenCalled();
    expect(h.fetchImpl).not.toHaveBeenCalled();
    // Still No after a restart; asked nothing new, Marty still off.
    restartApp();
    expect(martyAgeStep()).toBe('declined');
  });

  it('No can be changed later from the same place: the question comes back, then Yes works', async () => {
    setMartyAgeAnswer('no');
    setMartyAgeAnswer(null); // "Change my answer"
    expect(martyAgeStep()).toBe('ask');
    expect(storage.getItem(MARTY_AGE_KEY)).toBeNull();
    setMartyAgeAnswer('yes');
    expect(martyAgeStep()).toBe('confirmed');
  });

  it('Yes starts Marty and is remembered after a restart (asked only once)', async () => {
    setMartyAgeAnswer('yes');
    restartApp();
    expect(martyAgeStep()).toBe('confirmed');
    expect(shouldAutoStart({ ...autoBase, ageConfirmed: martyAgeConfirmed() })).toBe(true);
    const h = harness();
    const snap = await h.coordinator().start();
    expect(snap.voice.state).toBe('listening');
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('every start request carries age_confirmed: true', async () => {
    setMartyAgeAnswer('yes');
    const h = harness();
    await h.coordinator().start();
    expect(h.bodies[0].age_confirmed).toBe(true);
    expect(Object.keys(h.bodies[0]).sort()).toEqual(['age_confirmed', 'consentVersion', 'mode']);
  });

  it('the request client itself refuses without the confirmation, before any network call', async () => {
    const h = harness();
    const r = await requestVoiceSession({ supabaseUrl: URL, accessToken: 'a', consentVersion: 'v', fetchImpl: h.fetchImpl });
    expect(r.ok).toBe(false);
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it('broken or private storage: treated as not asked (question shows), never as Yes', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    _reloadMartyAgeFromStorage();
    expect(martyAgeStep()).toBe('ask');
    storage.setItem(MARTY_AGE_KEY, 'maybe');
    vi.stubGlobal('localStorage', storage);
    _reloadMartyAgeFromStorage();
    expect(martyAgeStep()).toBe('ask');
  });
});

describe('the Marty screen and voice hook use the 21+ check', () => {
  const overlay = readFileSync(resolve(__dirname, '../src/marty/MartyOverlay.tsx'), 'utf8');
  const hook = readFileSync(resolve(__dirname, '../src/marty/useMartyVoice.ts'), 'utf8');

  it('the question is shown before the voice-consent step', () => {
    const q = overlay.indexOf('testID="marty-age-question"');
    const consent = overlay.indexOf('testID="marty-enable-voice"');
    expect(q).toBeGreaterThan(0);
    expect(q).toBeLessThan(consent);
    expect(overlay).toContain('Are you 21 or older?');
    expect(overlay).toContain('testID="marty-age-declined"');
    expect(overlay).toContain("onPress={() => setMartyAgeAnswer(null)}");
    expect(overlay).toContain("ageConfirmed: ageStep === 'confirmed'");
  });

  it('starting a session and Enable voice both stop unless the answer is Yes', () => {
    expect(hook).toContain('if (!martyAgeConfirmed()) return;');
    expect(hook).toContain('if (busy || !martyAgeConfirmed()) return;');
  });
});
