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
  it('sends exactly consentVersion/contender/mode/age_confirmed', async () => {
    const f = vi.fn().mockResolvedValue(res(200, openai));
    const r = await req(f);
    expect(r.ok).toBe(true);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual(['age_confirmed', 'consentVersion', 'contender', 'mode']);
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
