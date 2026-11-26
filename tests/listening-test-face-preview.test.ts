import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FACE_DEMO_LINES } from '../src/listeningTest/logic';
import { FACE_B_FUNCTION, requestFaceB } from '../src/listeningTest/faceBClient';

const opts = { supabaseUrl: 'https://x.supabase.co', accessToken: 't', ageConfirmed: true, voice: 'current' as never };
const mockFetch = (res: unknown) => vi.stubGlobal('fetch', vi.fn(async () => res));
afterEach(() => vi.unstubAllGlobals());

describe('face preview', () => {
  it('has the two demo lines', () => {
    expect(FACE_DEMO_LINES.map(l => l.id)).toEqual(['annoyed', 'sarcastic']);
    expect(FACE_DEMO_LINES[0].label).toBe('Annoyed line');
    expect(FACE_DEMO_LINES[0].text).toContain('forty-dollar single malt');
    expect(FACE_DEMO_LINES[1].text).toContain('vodka soda');
  });
  it('posts to the placeholder function with only ageConfirmed and voice', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ streamUrl: 'https://v/1' }) }));
    vi.stubGlobal('fetch', f);
    const r = await requestFaceB(opts);
    expect(r).toMatchObject({ ok: true, streamUrl: 'https://v/1' });
    const [url, init] = f.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe(`https://x.supabase.co/functions/v1/${FACE_B_FUNCTION}`);
    expect(Object.keys(JSON.parse(init.body)).sort()).toEqual(['ageConfirmed', 'voice']);
  });
  it('maps 404 to notBuilt', async () => {
    mockFetch({ ok: false, status: 404, text: async () => '' });
    expect(await requestFaceB(opts)).toMatchObject({ ok: false, notBuilt: true, message: 'Option B is not switched on yet. The server team is still building it.' });
  });
  it('maps key missing via text()', async () => {
    mockFetch({ ok: false, status: 503, text: async () => '{"error":"FACE_SERVICE_KEY missing"}' });
    expect(await requestFaceB(opts)).toMatchObject({ ok: false, keyMissing: true, message: "Face service key not set. Option B can't start until it is added." });
  });
  it('maps key missing via json-only mock and error code', async () => {
    mockFetch({ ok: false, status: 500, json: async () => ({ error: 'face_key_missing' }) });
    expect(await requestFaceB(opts)).toMatchObject({ ok: false, keyMissing: true });
  });
  it('maps network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await requestFaceB(opts)).toEqual({ ok: false, message: 'Option B could not be reached.' });
  });
  it('maps other errors', async () => {
    mockFetch({ ok: false, status: 500, text: async () => 'boom' });
    expect(await requestFaceB(opts)).toMatchObject({ ok: false, status: 500, message: 'Option B could not start (error 500).' });
  });
  it('screen source has the preview and guests keep PhotoFace', () => {
    const src = readFileSync('app/listening-test.tsx', 'utf8');
    for (const s of ['FACE PREVIEW', 'LiveFace', 'Start B', 'onVoiceStream']) expect(src).toContain(s);
    expect(readFileSync('src/marty/MartyFace.tsx', 'utf8')).toContain('PhotoFace');
  });
});
