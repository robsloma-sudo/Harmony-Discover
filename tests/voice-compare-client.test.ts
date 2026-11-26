import { describe, expect, it, vi } from 'vitest';
import { probeListeningTest, requestCompareSession } from '../src/voice/voiceCompareClient';
import { MARTY_BOSTON_CONSENT_VERSION } from '../src/voice/martySullivanBoston';

const url = `https://${'lqqmwqrffelgnbngrkep'}.supabase.co`;
const res = (status: number, body: unknown) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;
const openai = {
  contender: 'A', provider: 'openai_realtime', ephemeralToken: 't', expiresAt: '2026-01-01T00:00:00Z',
  transport: 'webrtc', connectHint: 'realtime', voice: 'v',
};
const gemini = { contender: 'C', provider: 'gemini_live', ephemeralToken: 't', transport: 'websocket' };
const req = (f: unknown, over: Record<string, unknown> = {}) =>
  requestCompareSession({
    supabaseUrl: url, accessToken: 'tok', contender: 'A', mode: 'hands_free', ageConfirmed: true,
    fetchImpl: f as typeof fetch, ...over,
  });

describe('probeListeningTest', () => {
  it('is true only on 400, with body {}', async () => {
    const f = vi.fn().mockResolvedValue(res(400, {}));
    expect(await probeListeningTest({ supabaseUrl: url, accessToken: 'tok', fetchImpl: f as unknown as typeof fetch })).toBe(true);
    expect(f.mock.calls[0][1].body).toBe('{}');
    expect(f.mock.calls[0][0]).toBe(`${url}/functions/v1/discover-voice-compare`);
    for (const s of [200, 404, 403, 429, 500]) {
      const g = vi.fn().mockResolvedValue(res(s, {}));
      expect(await probeListeningTest({ supabaseUrl: url, accessToken: 'tok', fetchImpl: g as unknown as typeof fetch })).toBe(false);
    }
  });
  it('is false on network error, wrong url (no fetch)', async () => {
    const f = vi.fn().mockRejectedValue(new Error('x'));
    expect(await probeListeningTest({ supabaseUrl: url, accessToken: 'tok', fetchImpl: f as unknown as typeof fetch })).toBe(false);
    const g = vi.fn();
    expect(await probeListeningTest({ supabaseUrl: 'https://evil.example', accessToken: 'tok', fetchImpl: g as unknown as typeof fetch })).toBe(false);
    expect(g).not.toHaveBeenCalled();
  });
});

describe('requestCompareSession', () => {
  it('sends exactly consentVersion/contender/mode/age_confirmed/voice', async () => {
    const f = vi.fn().mockResolvedValue(res(200, openai));
    const r = await req(f);
    expect(r.ok).toBe(true);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual(['age_confirmed', 'consentVersion', 'contender', 'mode', 'voice']);
    expect(body.voice).toBe('current');
    expect(body.age_confirmed).toBe(true);
    expect(body.consentVersion).toBe(MARTY_BOSTON_CONSENT_VERSION);
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });
  it('adds reveal only when true', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { ...openai, model: 'm' }));
    const r = await req(f, { reveal: true });
    expect(JSON.parse(f.mock.calls[0][1].body).reveal).toBe(true);
    expect(r.ok && r.grant.model).toBe('m');
    const g = vi.fn().mockResolvedValue(res(200, openai));
    await req(g, { reveal: false });
    expect('reveal' in JSON.parse(g.mock.calls[0][1].body)).toBe(false);
  });
  it('accepts both grant shapes, no model unless present', async () => {
    const a = await req(vi.fn().mockResolvedValue(res(200, openai)));
    expect(a.ok && 'model' in a.grant).toBe(false);
    const g = await req(vi.fn().mockResolvedValue(res(200, gemini)), { contender: 'C' });
    expect(g.ok && g.grant.provider).toBe('gemini_live');
    expect(g.ok && 'model' in g.grant).toBe(false);
  });
  it('rejects bad grants', async () => {
    const bad = [
      { ...openai, provider: 'other' },
      { ...openai, connectHint: 'weird' },
      { ...openai, ephemeralToken: '' },
      { ...gemini, ephemeralToken: '  ' },
      { ...gemini, transport: 'webrtc' },
      { ...openai, contender: 'D' },
    ];
    for (const b of bad) expect((await req(vi.fn().mockResolvedValue(res(200, b)))).ok).toBe(false);
  });
  it('maps statuses to plain messages', async () => {
    const m = async (s: number, body: unknown = {}) => {
      const r = await req(vi.fn().mockResolvedValue(res(s, body)));
      return r.ok ? '' : r.message;
    };
    expect(await m(404)).toBe('Not found.');
    expect(await m(403)).toMatch(/consent/i);
    expect(await m(429)).toMatch(/wait/i);
    expect(await m(503)).toMatch(/not set up/i);
    expect(await m(502, { error: 'secret provider text', status: 400 })).toContain('400');
    expect(await m(502, { error: 'secret provider text', status: 400 })).not.toContain('secret');
  });
  it('network failure and wrong url', async () => {
    expect((await req(vi.fn().mockRejectedValue(new Error('x')))).ok).toBe(false);
    const f = vi.fn();
    expect((await req(f, { supabaseUrl: 'https://evil.example' })).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('stays off without a Yes to the 21+ question: no network call, no age_confirmed', async () => {
    for (const ageConfirmed of [false, undefined]) {
      const f = vi.fn().mockResolvedValue(res(200, openai));
      const r = await req(f, { ageConfirmed });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.message).toBe('Marty is only for guests 21 or older.');
      expect(f).not.toHaveBeenCalled();
    }
  });
  it('reveal also carries age_confirmed', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { ...openai, model: 'm' }));
    await req(f, { reveal: true });
    expect(JSON.parse(f.mock.calls[0][1].body).age_confirmed).toBe(true);
  });
});

describe('option B: face and connection', () => {
  const face = { provider: 'anam', sessionToken: 'ft', audioInput: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 } };
  const eleven = { contender: 'A', provider: 'elevenlabs_agents', signedUrl: 'wss://api.elevenlabs.io/x?token=1', transport: 'websocket', connectHint: 'elevenlabs', voice: 'elevenlabs' };
  const elevenRtc = { contender: 'A', provider: 'elevenlabs_agents', conversationToken: 'ct', transport: 'webrtc', connectHint: 'elevenlabs', voice: 'elevenlabs' };
  it('sends face and connection only when given', async () => {
    const f = vi.fn().mockResolvedValue(res(200, openai));
    await req(f);
    const b0 = JSON.parse(f.mock.calls[0][1].body);
    expect('face' in b0 || 'connection' in b0).toBe(false);
    const g = vi.fn().mockResolvedValue(res(200, openai));
    await req(g, { face: 'photo', connection: 'websocket' });
    const b1 = JSON.parse(g.mock.calls[0][1].body);
    expect(b1.face).toBe('photo');
    expect(b1.connection).toBe('websocket');
  });
  it('parses the face block and drops a malformed one', async () => {
    const ok = await req(vi.fn().mockResolvedValue(res(200, { ...openai, face })));
    expect(ok.ok && ok.grant.face).toEqual(face);
    for (const bad of [
      { ...face, provider: 'x' }, { ...face, sessionToken: '' }, { ...face, audioInput: { ...face.audioInput, sampleRate: 24000 } },
      { ...face, audioInput: null }, 'nope',
    ]) {
      const r = await req(vi.fn().mockResolvedValue(res(200, { ...openai, face: bad })));
      expect(r.ok && 'face' in r.grant).toBe(false);
      expect(r.ok).toBe(true);
    }
  });
  it('maps the three face refusals, status number only', async () => {
    const m = async (s: number, body: unknown) => {
      const f = vi.fn().mockResolvedValue({ status: s, ok: false, text: async () => JSON.stringify(body) } as unknown as Response);
      return req(f, { face: 'photo' });
    };
    const a = await m(503, { error: 'face service key not set' });
    expect(!a.ok && a.message).toBe("Face service key not set. Option B can't start until it is added.");
    expect(!a.ok && a.faceKeyMissing).toBe(true);
    const b = await m(503, { error: 'face not set up' });
    expect(!b.ok && b.message).toBe("Marty's face isn't set up in the face service yet (no face L avatar id).");
    expect(!b.ok && b.faceKeyMissing).toBeUndefined();
    const c = await m(502, { error: 'The face could not start.', status: 401, step: 'face_token' });
    expect(!c.ok && c.message).toBe('The face service could not start (error 401).');
    const d = await m(502, { error: 'The face could not start.', status: 'secret provider text', step: 'face_token' });
    expect(!d.ok && d.message).toBe('The face service could not start.');
  });
  it('accepts the ElevenLabs websocket and webrtc grants', async () => {
    const w = await req(vi.fn().mockResolvedValue(res(200, { ...eleven, model: 'elevenlabs', face })));
    expect(w.ok && w.grant.provider === 'elevenlabs_agents' && w.grant.transport === 'websocket' && w.grant.signedUrl).toBe(eleven.signedUrl);
    expect(w.ok && w.grant.face?.sessionToken).toBe('ft');
    const r = await req(vi.fn().mockResolvedValue(res(200, elevenRtc)));
    expect(r.ok && r.grant.provider === 'elevenlabs_agents' && r.grant.transport === 'webrtc' && r.grant.conversationToken).toBe('ct');
  });
  it('rejects bad ElevenLabs grants (not wss, missing fields)', async () => {
    for (const b of [
      { ...eleven, signedUrl: 'ws://x' }, { ...eleven, signedUrl: 'https://x' }, { ...eleven, signedUrl: '' },
      { ...eleven, connectHint: 'realtime' }, { ...eleven, voice: 'current' }, { ...elevenRtc, conversationToken: '' },
      { ...eleven, transport: 'other' },
    ]) expect((await req(vi.fn().mockResolvedValue(res(200, b)))).ok).toBe(false);
  });
});

