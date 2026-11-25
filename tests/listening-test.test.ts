import { describe, expect, it } from 'vitest';
import {
  SCORES_KEY, TEST_LINES, TOOL_UNAVAILABLE_OUTPUT, base64ToBytes, bytesToBase64, failureMessage, floatToPcm16,
  functionCallAnswerEvents, geminiAudioMessage, loadScores, parseGeminiMessage, pcm16ToFloat, resample, revealEnabled, saveScores,
} from '../src/listeningTest/logic';

function memStore(initial?: string) {
  const m = new Map<string, string>(); if (initial) m.set(SCORES_KEY, initial);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}
const throwing = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };

describe('scores storage', () => {
  it('saves and loads under the agreed key', () => {
    const s = memStore();
    expect(saveScores({ A: 4, B: 'failed' }, s)).toBe(true);
    expect(s.m.has('discover.listeningTest.scores')).toBe(true);
    expect(loadScores(s)).toEqual({ A: 4, B: 'failed' });
  });
  it('survives storage that throws or is missing', () => {
    expect(saveScores({ A: 1 }, throwing)).toBe(false);
    expect(loadScores(throwing)).toEqual({});
    expect(saveScores({ A: 1 }, null)).toBe(false);
    expect(loadScores(null)).toEqual({});
  });
  it('drops bad stored data', () => {
    expect(loadScores(memStore('not json'))).toEqual({});
    expect(loadScores(memStore(JSON.stringify({ A: 9, B: 3, C: 'x', D: 2 })))).toEqual({ B: 3 });
  });
});

describe('reveal', () => {
  it('needs every letter scored or failed', () => {
    expect(revealEnabled({})).toBe(false);
    expect(revealEnabled({ A: 3, B: 4 })).toBe(false);
    expect(revealEnabled({ A: 3, B: 4, C: 'failed' })).toBe(true);
    expect(revealEnabled({ A: 'failed', B: 'failed', C: 'failed' })).toBe(true);
  });
});

describe('lines and messages', () => {
  it('has five fixed lines', () => {
    expect(TEST_LINES).toHaveLength(5);
    expect(new Set(TEST_LINES.map(l => l.id)).size).toBe(5);
  });
  it('failure messages', () => {
    expect(failureMessage('B', 400)).toBe('B could not start (provider said 400)');
    expect(failureMessage('C', 503)).toBe('C is not set up yet.');
    expect(failureMessage('A')).toBe('A could not start.');
  });
});

describe('function call answers', () => {
  it('realtime sends output plus response.create, live sends output only', () => {
    const rt = functionCallAnswerEvents('realtime', 'c1') as any[];
    const live = functionCallAnswerEvents('live', 'c1') as any[];
    expect(rt.map(e => e.type)).toEqual(['conversation.item.create', 'response.create']);
    expect(live.map(e => e.type)).toEqual(['conversation.item.create']);
    expect(rt[0].item).toEqual({ type: 'function_call_output', call_id: 'c1', output: TOOL_UNAVAILABLE_OUTPUT });
  });
});

describe('PCM16 and Gemini helpers', () => {
  it('round-trips PCM16', () => {
    const f = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const back = pcm16ToFloat(floatToPcm16(f));
    f.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 3));
    expect(floatToPcm16(new Float32Array([2, -2]))).toEqual(floatToPcm16(new Float32Array([1, -1])));
  });
  it('base64 round-trips', () => {
    const b = new Uint8Array([0, 1, 2, 250, 255]);
    expect(Array.from(base64ToBytes(bytesToBase64(b)))).toEqual(Array.from(b));
  });
  it('resamples to the target length', () => {
    expect(resample(new Float32Array(480), 48000, 16000)).toHaveLength(160);
  });
  it('builds the audio message', () => {
    const m = JSON.parse(geminiAudioMessage(new Uint8Array([1, 2])));
    expect(m.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
  });
  it('parses server messages', () => {
    const r = parseGeminiMessage({ serverContent: { interrupted: true, modelTurn: { parts: [{ inlineData: { data: 'AAA=' } }, { text: 'x' }] } } });
    expect(r.interrupted).toBe(true);
    expect(r.audio).toEqual(['AAA=']);
    expect(parseGeminiMessage({ setupComplete: {} }).setupComplete).toBe(true);
    expect(parseGeminiMessage(null).audio).toEqual([]);
  });
});

describe('provider connection details (checked Nov 25)', () => {
  it('Gemini first message carries the model, as Google marks it required', async () => {
    const { geminiSetupMessage, GEMINI_LIVE_MODEL } = await import('../src/listeningTest/logic');
    expect(JSON.parse(geminiSetupMessage())).toEqual({ setup: { model: GEMINI_LIVE_MODEL } });
    expect(GEMINI_LIVE_MODEL.startsWith('models/')).toBe(true);
  });
  it('a not-yet-wired contender gets a neutral message that names no model', async () => {
    const { notWiredMessage } = await import('../src/listeningTest/logic');
    expect(notWiredMessage('B')).toBe('B needs a server change before it can connect.');
    expect(notWiredMessage('B')).not.toMatch(/gpt|openai|live|gemini/i);
  });
  it('Gemini uses the constrained ephemeral-token socket with access_token', async () => {
    const src = await import('node:fs').then(fs => fs.readFileSync('src/listeningTest/transports.ts', 'utf8'));
    expect(src).toContain('GenerativeService.BidiGenerateContentConstrained');
    expect(src).toContain('?access_token=');
    expect(src).not.toContain('/v1/live/calls');
  });
});
