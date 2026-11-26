// P-20261126-0004 part 2: Current voice / ElevenLabs voice pick on the hidden listening test only.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VOICE, ELEVENLABS_KEY_MISSING, VOICE_PICKS, isElevenLabsKeyMissing } from '../src/listeningTest/logic';
import { requestCompareSession } from '../src/voice/voiceCompareClient';
import { connectElevenLabs } from '../src/listeningTest/elevenlabsTransport';

// The real kit is browser-only; these tests pass their own start function, so the kit is never loaded.
vi.mock('../src/listeningTest/elevenlabsKitLoader', () => ({ loadElevenLabsStart: vi.fn() }));

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
  it('current voice (default or picked) sends exactly today\'s request: no voice field', async () => {
    const f = okFetch();
    await requestCompareSession({ ...base, fetchImpl: f as unknown as typeof fetch });
    await requestCompareSession({ ...base, voice: 'current', fetchImpl: f as unknown as typeof fetch });
    await requestCompareSession({ ...base, voice: 'bogus' as never, fetchImpl: f as unknown as typeof fetch });
    for (const call of f.mock.calls) {
      const body = JSON.parse(String(call[1].body));
      expect(Object.keys(body).sort()).toEqual(['age_confirmed', 'consentVersion', 'contender', 'mode']);
      expect(body.age_confirmed).toBe(true);
    }
  });
  it('ElevenLabs pick adds voice elevenlabs', async () => {
    const f = okFetch();
    await requestCompareSession({ ...base, voice: 'elevenlabs', fetchImpl: f as unknown as typeof fetch });
    const body = JSON.parse(String(f.mock.calls[0][1].body));
    expect(Object.keys(body).sort()).toEqual(['age_confirmed', 'consentVersion', 'contender', 'mode', 'voice']);
    expect(body.voice).toBe('elevenlabs');
  });
  it('reveal carries the voice too', async () => {
    const f = okFetch();
    await requestCompareSession({ ...base, voice: 'elevenlabs', reveal: true, fetchImpl: f as unknown as typeof fetch });
    const body = JSON.parse(String(f.mock.calls[0][1].body));
    expect(body.reveal).toBe(true);
    expect(body.voice).toBe('elevenlabs');
  });
  it('server "ElevenLabs key not set" is shown plainly', async () => {
    for (const [status, text] of [[503, '{"error":"ElevenLabs key not set."}'], [500, 'elevenlabs_key_not_set']] as const) {
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

describe('ElevenLabs answer from the server', () => {
  const el = { contender: 'B', provider: 'elevenlabs_agents', conversationToken: 'ct', transport: 'webrtc', connectHint: 'elevenlabs', voice: 'elevenlabs' };
  const answer = (j: unknown) => vi.fn(async () => new Response(JSON.stringify(j), { status: 200 }));
  it('accepts the backend shape, with or without model', async () => {
    const r = await requestCompareSession({ ...base, voice: 'elevenlabs', fetchImpl: answer(el) as unknown as typeof fetch });
    expect(r).toEqual({ ok: true, grant: el });
    const r2 = await requestCompareSession({ ...base, voice: 'elevenlabs', reveal: true, fetchImpl: answer({ ...el, model: 'elevenlabs' }) as unknown as typeof fetch });
    expect(r2.ok && r2.grant.model).toBe('elevenlabs');
  });
  it('rejects a broken ElevenLabs answer', async () => {
    for (const bad of [{ ...el, conversationToken: '' }, { ...el, transport: 'websocket' }, { ...el, connectHint: 'realtime' }, { ...el, voice: 'current' }]) {
      const r = await requestCompareSession({ ...base, voice: 'elevenlabs', fetchImpl: answer(bad) as unknown as typeof fetch });
      expect(r).toEqual({ ok: false, message: 'The server sent an unexpected answer.' });
    }
  });
});

describe('ElevenLabs connection', () => {
  it('starts with only the token over webrtc, and hang-up ends the session once', async () => {
    const endSession = vi.fn(async () => undefined);
    const startImpl = vi.fn(async (_o: unknown) => ({ endSession }));
    const h = await connectElevenLabs({ conversationToken: 'ct', hooks: { onClosed: vi.fn() }, startImpl });
    const opts = startImpl.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(opts.conversationToken).toBe('ct');
    expect(opts.connectionType).toBe('webrtc');
    expect(Object.keys(opts).sort()).toEqual(['connectionType', 'conversationToken', 'onDisconnect', 'onError']);
    h.stop(); h.stop();
    expect(endSession).toHaveBeenCalledTimes(1);
  });
  it('server hang-up reports Connection ended once; an error ends the session', async () => {
    let cb: Record<string, () => void> = {};
    const endSession = vi.fn(async () => undefined);
    const onClosed = vi.fn();
    await connectElevenLabs({ conversationToken: 'ct', hooks: { onClosed }, startImpl: async (o) => { cb = o as never; return { endSession }; } });
    cb.onDisconnect(); cb.onDisconnect();
    expect(onClosed).toHaveBeenCalledTimes(1);
    const onClosed2 = vi.fn();
    await connectElevenLabs({ conversationToken: 'ct', hooks: { onClosed: onClosed2 }, startImpl: async (o) => { cb = o as never; return { endSession }; } });
    cb.onError();
    expect(onClosed2).toHaveBeenCalledWith('failed');
    expect(endSession).toHaveBeenCalledTimes(1);
  });
});

describe('only on the hidden test screen', () => {
  const page = readFileSync('app/listening-test.tsx', 'utf8');
  it('the screen shows the pick and sends it with every start and reveal', () => {
    expect(page).toContain('testID="listening-test-voice-pick"');
    expect(page).toContain('useState<VoicePick>(DEFAULT_VOICE)');
    expect(page.match(/requestCompareSession\(\{[^}]*ageConfirmed, voice[^}]*\}\)/g)?.length).toBe(2);
  });
  it('the ElevenLabs kit is loaded on demand, only from the listening test', () => {
    const t = readFileSync('src/listeningTest/elevenlabsKitLoader.ts', 'utf8');
    expect(t).toContain("await import('@elevenlabs/client/dist/platform/web/index.js')");
    expect(t).not.toMatch(/^import [^t].*@elevenlabs\/client/m);
    expect(page).toContain("grant.provider === 'elevenlabs_agents' && voice !== 'elevenlabs'");
  });
  it('the pick comes after the Rob-only and 21+ checks', () => {
    expect(page.indexOf("probe === 'no'")).toBeLessThan(page.indexOf('listening-test-voice-pick'));
    expect(page.indexOf('if (!ageConfirmed) return')).toBeLessThan(page.indexOf('listening-test-voice-pick'));
  });
  it('the guest Marty code never mentions ElevenLabs or the pick', () => {
    for (const f of ['src/marty/MartyOverlay.tsx', 'src/marty/useMartyVoice.ts', 'src/voice/voiceSessionClient.ts', 'app/index.tsx', 'app/_layout.tsx']) {
      let src = ''; try { src = readFileSync(f, 'utf8'); } catch { continue; }
      expect(src.toLowerCase()).not.toContain('elevenlabs');
      expect(src).not.toContain('VoicePick');
    }
  });
});
