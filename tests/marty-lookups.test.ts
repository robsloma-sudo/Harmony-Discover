import { describe, expect, it, vi } from 'vitest';
import { isMartyLookupTool, MARTY_LOOKUP_UNAVAILABLE, runMartyLookup } from '../src/voice/martyLookups';

const url = `https://${'lqqmwqrffelgnbngrkep'}.supabase.co`;
const res = (status: number, body: unknown) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;
const run = (fetchImpl: unknown, over: Record<string, unknown> = {}) =>
  runMartyLookup({
    supabaseUrl: url,
    accessToken: 'tok',
    tool: 'lookup_cocktail',
    rawArguments: '{"name":"Negroni"}',
    fetchImpl: fetchImpl as typeof fetch,
    ...over,
  });

describe('isMartyLookupTool', () => {
  it('matches look-up tools only', () => {
    for (const n of ['lookup_cocktail', 'lookup_bottle', 'lookup_brand', 'lookup_journey', 'pairing_ideas', 'my_saved_drinks']) {
      expect(isMartyLookupTool(n)).toBe(true);
    }
    expect(isMartyLookupTool('navigate_discover')).toBe(false);
    expect(isMartyLookupTool('control_nearby_atlas')).toBe(false);
  });
});

describe('runMartyLookup', () => {
  it('sends exact body keys and headers; object args as object', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { ok: true, tool: 'lookup_cocktail', output: '{"a":1}' }));
    const out = await run(f);
    expect(out).toBe('{"a":1}');
    const [u, init] = f.mock.calls[0];
    expect(u).toBe(`${url}/functions/v1/discover-voice-session`);
    expect(init.headers.Authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(['action', 'arguments', 'tool']);
    expect(body).toEqual({ action: 'lookup', tool: 'lookup_cocktail', arguments: { name: 'Negroni' } });
  });

  it('passes non-object argument strings as received', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { output: 'x' }));
    await run(f, { rawArguments: 'not json' });
    expect(JSON.parse(f.mock.calls[0][1].body).arguments).toBe('not json');
  });

  it('passes output through unchanged', async () => {
    const odd = ' {"x": [1,  2]}\n';
    expect(await run(vi.fn().mockResolvedValue(res(200, { output: odd })))).toBe(odd);
  });

  it.each([403, 429, 503])('status %i -> unavailable', async (s) => {
    expect(await run(vi.fn().mockResolvedValue(res(s, { error: 'x' })))).toBe(MARTY_LOOKUP_UNAVAILABLE);
  });

  it('network throw, bad JSON and missing output -> unavailable', async () => {
    expect(await run(vi.fn().mockRejectedValue(new Error('boom')))).toBe('{"status":"unavailable"}');
    const bad = { status: 200, ok: true, json: async () => { throw new Error('bad'); } };
    expect(await run(vi.fn().mockResolvedValue(bad))).toBe(MARTY_LOOKUP_UNAVAILABLE);
    expect(await run(vi.fn().mockResolvedValue(res(200, { ok: true })))).toBe(MARTY_LOOKUP_UNAVAILABLE);
    expect(await run(vi.fn().mockResolvedValue(res(200, { output: 5 })))).toBe(MARTY_LOOKUP_UNAVAILABLE);
  });

  it('refuses a wrong supabaseUrl without fetching', async () => {
    const f = vi.fn();
    expect(await run(f, { supabaseUrl: 'https://evil.example.com' })).toBe(MARTY_LOOKUP_UNAVAILABLE);
    expect(f).not.toHaveBeenCalled();
  });

  it('refuses arguments over 2000 chars without fetching', async () => {
    const f = vi.fn();
    expect(await run(f, { rawArguments: JSON.stringify({ q: 'a'.repeat(2000) }) })).toBe(MARTY_LOOKUP_UNAVAILABLE);
    expect(f).not.toHaveBeenCalled();
  });
});
