// P-20261126-0004 part 2: Current voice / ElevenLabs voice pick on the hidden listening test only.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE, ELEVENLABS_KEY_MISSING, VOICE_PICKS, isElevenLabsKeyMissing } from '../src/listeningTest/logic';
import { requestCompareSession } from '../src/voice/voiceCompareClient';

const URL = 'https://lqqmwqrffelgnbngrkep.supabase.co';
const okGrant = { contender: 'A', provider: 'gemini_live', ephemeralToken: 't', transport: 'websocket' };
function okFetch() {
  return vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify(okGrant), { status: 200 }));
}
const base = { supabaseUrl: URL, accessToken: 'tok', contender: 'A' as const, mode: 'hands_free' as const, ageConfirmed: true };

describe('voice pick', () => {
  it('two picks, default is the current voice', () => {
    expect(VOICE_PICKS.map(v => v.label)).toEqual(['Current voice', 'ElevenLabs voice']);
    expect(DEFAULT_VOICE).toBe('current');
  });
  it('default start sends voice current with age_confirmed', async () => {
    const f = okFetch();
    await requestCompareSession({ ...base, fetchImpl: f as unknown as typeof fetch });
    const body = JSON.parse(String(f.mock.calls[0][1].body));
    expect(body.voice).toBe('current');
    expect(body.age_confirmed).toBe(true);
    expect(Object.keys(body).sort()).toEqual(['age_confirmed', 'consentVersion', 'contender', 'mode', 'voice']);
  });
  it('ElevenLabs pick sends voice elevenlabs; unknown values fall back to current', async () => {
    const f = okFetch();
    await requestCompareSession({ ...base, voice: 'elevenlabs', fetchImpl: f as unknown as typeof fetch });
    await requestCompareSession({ ...base, voice: 'bogus' as never, fetchImpl: f as unknown as typeof fetch });
    expect(JSON.parse(String(f.mock.calls[0][1].body)).voice).toBe('elevenlabs');
    expect(JSON.parse(String(f.mock.calls[1][1].body)).voice).toBe('current');
  });
  it('reveal carries the voice too', async () => {
    const f = okFetch();
    await requestCompareSession({ ...base, voice: 'elevenlabs', reveal: true, fetchImpl: f as unknown as typeof fetch });
    const body = JSON.parse(String(f.mock.calls[0][1].body));
    expect(body.reveal).toBe(true);
    expect(body.voice).toBe('elevenlabs');
  });
  it('server "ElevenLabs key not set" is shown plainly', async () => {
    for (const [status, text] of [[503, '{"error":"ElevenLabs key not set"}'], [500, 'elevenlabs_key_not_set']] as const) {
      const f = vi.fn(async () => new Response(text, { status }));
      const r = await requestCompareSession({ ...base, voice: 'elevenlabs', fetchImpl: f as unknown as typeof fetch });
      expect(r).toEqual({ ok: false, status, message: ELEVENLABS_KEY_MISSING, keyMissing: true });
    }
    expect(isElevenLabsKeyMissing('Some other error')).toBe(false);
  });
  it('502 still reports only the provider status', async () => {
    const f = vi.fn(async () => new Response('{"status":401,"raw":"secret detail"}', { status: 502 }));
    const r = await requestCompareSession({ ...base, fetchImpl: f as unknown as typeof fetch });
    expect(r).toEqual({ ok: false, status: 502, message: 'The provider refused the session (provider said 401).' });
  });
  it('no Yes to 21+: still no network call, whatever the voice', async () => {
    const f = okFetch();
    const r = await requestCompareSession({ ...base, ageConfirmed: false, voice: 'elevenlabs', fetchImpl: f as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('only on the hidden test screen', () => {
  const page = readFileSync('app/listening-test.tsx', 'utf8');
  it('the screen shows the pick and sends it with every start and reveal', () => {
    expect(page).toContain('testID="listening-test-voice-pick"');
    expect(page).toContain('useState<VoicePick>(DEFAULT_VOICE)');
    expect(page.match(/requestCompareSession\(\{[^}]*ageConfirmed, voice[^}]*\}\)/g)?.length).toBe(3);
  });
  it('the pick comes after the Rob-only and 21+ checks', () => {
    expect(page.indexOf("probe === 'no'")).toBeLessThan(page.indexOf('listening-test-voice-pick'));
    expect(page.indexOf('if (!ageConfirmed) return')).toBeLessThan(page.indexOf('listening-test-voice-pick'));
  });
  it('the guest Marty code never mentions ElevenLabs or the pick', () => {
    for (const f of ['src/marty/MartyOverlay.tsx', 'src/marty/useMartyVoice.ts', 'src/voice/voiceSessionClient.ts']) {
      let src = ''; try { src = readFileSync(f, 'utf8'); } catch { continue; }
      expect(src.toLowerCase()).not.toContain('elevenlabs');
      expect(src).not.toContain('VoicePick');
    }
  });
});
