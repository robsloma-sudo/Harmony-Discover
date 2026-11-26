// P-20261126-0102 part 2 (Rob): "make my ElevenLabs 'Marty' voice THE live voice for guests in the Discover
// app, delete the hidden listening test entirely". The server chooses the voice; the app follows its grant.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _reloadMartyAgeFromStorage, martyAgeConfirmed, setMartyAgeAnswer } from '../src/marty/martyAge';
import { martySessionConfig } from '../src/marty/martyVoiceConfig';
import { isElevenLabsGrant, validateVoiceSessionGrant } from '../src/voice/sessionContract';
import { requestVoiceSession } from '../src/voice/voiceSessionClient';
import { VoiceSessionCoordinator, type VoicePlatformAdapter } from '../src/voice/voiceSessionCoordinator';
import { connectElevenLabsMarty, rmsFromElevenLabsVolume, type ElevenLabsStart } from '../src/voice/elevenlabsVoice';

vi.mock('../src/voice/elevenlabsKitLoader', () => ({ loadElevenLabsStart: vi.fn(async () => { throw new Error('kit not loadable in tests'); }) }));

const root = resolve(__dirname, '..');
const URL = `https://${'lqqmwqrffelgnbngrkep'}.supabase.co`;
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

const openAiGrant = () => ({
  sessionId: 's-openai', provider: 'openai_realtime', ephemeralToken: 'ephemeral-only', expiresAt: inMinutes(1),
  transport: 'webrtc', model: 'realtime-model', voice: 'approved-voice', mode: 'hands_free',
});
// Exactly the shape backend part 1 (fix/discover-backend/p-20261126-0102-1-elevenlabs-live, elevenLabsGrant) returns.
const elevenGrant = () => ({
  sessionId: 's-eleven', provider: 'elevenlabs_agents', transport: 'webrtc', connectHint: 'elevenlabs',
  model: 'elevenlabs', voice: 'elevenlabs', mode: 'hands_free', conversationToken: 'one-conversation-token',
  dynamicVariables: { marty_session: 'SESSION FLAVOR: grumpy' }, clientTools: ['open_panel', 'lookup_bottle'],
});

class MemoryStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); _reloadMartyAgeFromStorage(); });

describe('the voice grant follows the server choice', () => {
  it('accepts an ElevenLabs grant as hands-free with no API key', () => {
    const r = validateVoiceSessionGrant(elevenGrant());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isElevenLabsGrant(r.grant)).toBe(true);
    expect(r.grant.mode).toBe('hands_free');
    expect(r.grant).not.toHaveProperty('ephemeralToken');
    if (!isElevenLabsGrant(r.grant)) return;
    expect(r.grant.dynamicVariables).toEqual({ marty_session: 'SESSION FLAVOR: grumpy' });
    expect(r.grant.clientTools).toEqual(['open_panel', 'lookup_bottle']);
  });

  it('keeps the server stop switch: push_to_talk stays push_to_talk on ElevenLabs too', () => {
    const r = validateVoiceSessionGrant({ ...elevenGrant(), mode: 'push_to_talk' });
    expect(r.ok && r.grant.mode).toBe('push_to_talk');
  });

  it('drops odd tool names and non-text variables', () => {
    const r = validateVoiceSessionGrant({ ...elevenGrant(), clientTools: ['ok_tool', 'bad name', 3, 'ok_tool'], dynamicVariables: { a: 'x', b: 2 } });
    expect(r.ok).toBe(true);
    if (!r.ok || !isElevenLabsGrant(r.grant)) return;
    expect(r.grant.clientTools).toEqual(['ok_tool']);
    expect(r.grant.dynamicVariables).toEqual({ a: 'x' });
  });

  it('still accepts today\'s OpenAI grant unchanged (the server switch back needs no app change)', () => {
    const r = validateVoiceSessionGrant(openAiGrant());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isElevenLabsGrant(r.grant)).toBe(false);
    expect(r.grant.provider).toBe('openai_realtime');
  });

  it('refuses broken or over-long ElevenLabs grants', () => {
    expect(validateVoiceSessionGrant({ ...elevenGrant(), conversationToken: '' }).ok).toBe(false);
    expect(validateVoiceSessionGrant({ ...elevenGrant(), expiresAt: inMinutes(-1) }).ok).toBe(false);
    expect(validateVoiceSessionGrant({ ...elevenGrant(), expiresAt: inMinutes(10) }).ok).toBe(true);
    expect(validateVoiceSessionGrant({ ...elevenGrant(), mode: 'always' }).ok).toBe(false);
    expect(validateVoiceSessionGrant({ ...elevenGrant(), expiresAt: inMinutes(20) }).ok).toBe(false);
    expect(validateVoiceSessionGrant({ ...elevenGrant(), transport: 'websocket', conversationToken: undefined, signedUrl: 'wss://x' }).ok).toBe(false);
    // The OpenAI 2-minute bound is unchanged.
    expect(validateVoiceSessionGrant({ ...openAiGrant(), expiresAt: inMinutes(5) }).ok).toBe(false);
  });
});

describe('the app sends the same request for both voices', () => {
  for (const [name, grant] of [['OpenAI', openAiGrant], ['ElevenLabs', elevenGrant]] as const) {
    it(`${name}: same body keys, grant passed through to the connection`, async () => {
      setMartyAgeAnswer('yes');
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => grant() });
      const connect = vi.fn(async () => undefined);
      const platform: VoicePlatformAdapter = { requestMicrophonePermission: vi.fn(async () => 'granted' as const), connect, close: vi.fn(async () => undefined) };
      const c = new VoiceSessionCoordinator({
        ...martySessionConfig({ supabaseUrl: URL, accessToken: 'tok', screenContext: null }),
        fetchImpl: fetchImpl as unknown as typeof fetch, platform, consentConfirmed: true,
      });
      const result = await c.start();
      expect(result.voice.state).toBe('listening');
      const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
      // Backend part 1 allows exactly these keys; voiceEngines lets the server pick (ElevenLabs first).
      expect(Object.keys(body).sort()).toEqual(['age_confirmed', 'consentVersion', 'mode', 'voiceEngines']);
      expect(body.mode).toBe('hands_free');
      expect(body.voiceEngines).toEqual(['elevenlabs', 'openai']);
      expect(connect).toHaveBeenCalledWith(expect.objectContaining({ provider: grant().provider }));
    });
  }
});

describe('21+ is still required in front of Marty', () => {
  it('no answer or No: no request at all, whichever voice the server would pick', async () => {
    for (const a of [null, 'no'] as const) {
      setMartyAgeAnswer(a);
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => elevenGrant() });
      const r = await requestVoiceSession({ supabaseUrl: URL, accessToken: 'tok', consentVersion: 'v', mode: 'hands_free', ageConfirmed: martyAgeConfirmed(), fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(r.ok).toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });
});

function fakeKit() {
  const session = { endSession: vi.fn(async () => undefined), setMicMuted: vi.fn(), getOutputVolume: vi.fn(() => 0.5), sendUserMessage: vi.fn() };
  let opts: Parameters<ElevenLabsStart>[0] | null = null;
  let release: () => void = () => undefined;
  const gate = new Promise<void>(r => { release = r; });
  const start: ElevenLabsStart = vi.fn(async (o) => { opts = o; await gate; return session; });
  return { session, start, opts: () => opts!, release: () => release() };
}
const hooks = () => ({ onMode: vi.fn(), onLine: vi.fn(), onClosed: vi.fn() });

describe('ElevenLabs connection for Marty', () => {
  it('uses only the one-conversation token over WebRTC and passes speaking/listening and lines on', async () => {
    const kit = fakeKit(); kit.release();
    const h = hooks();
    const lookup = vi.fn(async () => '{"status":"ok"}');
    const handle = await connectElevenLabsMarty({ conversationToken: 'one-conversation-token', hooks: h, startImpl: kit.start, dynamicVariables: { marty_session: 'x' }, clientTools: { lookup_bottle: lookup } });
    expect(kit.opts().conversationToken).toBe('one-conversation-token');
    expect(kit.opts().dynamicVariables).toEqual({ marty_session: 'x' });
    expect(await kit.opts().clientTools?.lookup_bottle({ q: 'rye' })).toBe('{"status":"ok"}');
    expect(lookup).toHaveBeenCalledWith({ q: 'rye' });
    expect(kit.session.setMicMuted).not.toHaveBeenCalled();
    expect(kit.opts().connectionType).toBe('webrtc');
    kit.opts().onModeChange?.({ mode: 'speaking' });
    kit.opts().onModeChange?.({ mode: 'listening' });
    expect(h.onMode.mock.calls.map(c => c[0])).toEqual(['speaking', 'listening']);
    kit.opts().onMessage?.({ message: 'Wicked good pick.', source: 'ai' });
    kit.opts().onMessage?.({ message: 'What is this?', source: 'user' });
    expect(h.onLine.mock.calls).toEqual([['marty', 'Wicked good pick.'], ['you', 'What is this?']]);
    expect(handle.outputVolume()).toBe(0.5);
    expect(handle.sendText('  a neat pour  ')).toBe(true);
    expect(kit.session.sendUserMessage).toHaveBeenCalledWith('a neat pour');
    expect(handle.sendText('   ')).toBe(false);
  });

  it('Stop mutes the microphone at once, ends the conversation, and is safe twice', async () => {
    const kit = fakeKit(); kit.release();
    const h = hooks();
    const handle = await connectElevenLabsMarty({ conversationToken: 't', hooks: h, startImpl: kit.start });
    handle.stop(); handle.stop();
    expect(kit.session.setMicMuted).toHaveBeenCalledWith(true);
    expect(kit.session.endSession).toHaveBeenCalledTimes(1);
    expect(handle.outputVolume()).toBe(0);
    expect(handle.sendText('hello')).toBe(false);
    kit.opts().onDisconnect?.();
    expect(h.onClosed).not.toHaveBeenCalled();
  });

  it('hold-to-talk fallback starts with the microphone muted', async () => {
    const kit = fakeKit(); kit.release();
    const handle = await connectElevenLabsMarty({ conversationToken: 't', hooks: hooks(), startImpl: kit.start, startMuted: true });
    expect(kit.session.setMicMuted).toHaveBeenLastCalledWith(true);
    handle.setMicMuted(false);
    expect(kit.session.setMicMuted).toHaveBeenLastCalledWith(false);
  });

  it('a failure while connecting ends the conversation as soon as it opens', async () => {
    const kit = fakeKit();
    const h = hooks();
    const pending = connectElevenLabsMarty({ conversationToken: 't', hooks: h, startImpl: kit.start });
    await Promise.resolve();
    kit.opts().onError?.('boom');
    kit.release();
    await pending;
    expect(h.onClosed).toHaveBeenCalledWith('failed');
    expect(kit.session.endSession).toHaveBeenCalledTimes(1);
  });

  it('the line dropping tells Marty once', async () => {
    const kit = fakeKit(); kit.release();
    const h = hooks();
    await connectElevenLabsMarty({ conversationToken: 't', hooks: h, startImpl: kit.start });
    kit.opts().onDisconnect?.(); kit.opts().onDisconnect?.();
    expect(h.onClosed).toHaveBeenCalledTimes(1);
  });

  it('mouth level scales the kit volume into the speech range', () => {
    expect(rmsFromElevenLabsVolume(0)).toBe(0);
    expect(rmsFromElevenLabsVolume(Number.NaN)).toBe(0);
    expect(rmsFromElevenLabsVolume(0.5)).toBeCloseTo(0.175);
    expect(rmsFromElevenLabsVolume(4)).toBeCloseTo(0.35);
  });
});

describe('the Marty hook follows the grant and keeps Stop and the off switch', () => {
  const hook = readFileSync(resolve(root, 'src/marty/useMartyVoice.ts'), 'utf8');
  it('branches on the ElevenLabs grant before the OpenAI connection', () => {
    const branch = hook.indexOf('if (isElevenLabsGrant(grant)) { await connectElevenLabsTransport(grant); return; }');
    expect(branch).toBeGreaterThan(0);
    expect(branch).toBeLessThan(hook.indexOf("fetch('https://api.openai.com/v1/realtime/calls'"));
  });
  it('the synchronous mic-off (Stop, off switch, tab hidden) also ends the ElevenLabs conversation', () => {
    const micOff = hook.slice(hook.indexOf('const micOffNow = useCallback'), hook.indexOf('const stopLipSync'));
    expect(micOff).toContain('eleven?.stop();');
    expect(hook).toContain('useEffect(() => bindMartyOffSwitch(() => { micOffNow(); void stop(); }), [micOffNow, stop]);');
  });
  it('checks the off switch and Stop after connecting, and drives face L\'s mouth from the kit', () => {
    const el = hook.slice(hook.indexOf('async function connectElevenLabsTransport'), hook.indexOf('async function connectTransport'));
    expect(el).toContain("if (!getMartyPresence().enabled) throw new Error('Marty was turned off.');");
    expect(el).toContain("if (startGenRef.current !== stopGenRef.current) throw new Error('Marty was stopped.');");
    expect(el).toContain('startElevenLabsLipSync(handle);');
    expect(el).toContain('setHandsFree(alwaysOn);');
    expect(el).toContain('dynamicVariables: grant.dynamicVariables');
    expect(el).toContain('startMuted: !alwaysOn');
    expect(el).toContain('isMartyLookupTool(name)');
  });
  it('the ElevenLabs kit is only ever loaded on demand', () => {
    const loader = readFileSync(resolve(root, 'src/voice/elevenlabsKitLoader.ts'), 'utf8');
    expect(loader).toContain("await import('@elevenlabs/client/dist/platform/web/index.js')");
    expect(hook).not.toContain('@elevenlabs/client');
  });
});

describe('the hidden listening test is gone', () => {
  it('has no page, logic or compare client', () => {
    for (const p of ['app/listening-test.tsx', 'src/listeningTest', 'src/voice/voiceCompareClient.ts']) expect(existsSync(resolve(root, p))).toBe(false);
  });
  it('nothing in the app mentions it or its A/B/C choices', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(resolve(d, e.name)) : /\.(tsx?|json)$/.test(e.name) ? [resolve(d, e.name)] : []);
    for (const f of [...walk(resolve(root, 'app')), ...walk(resolve(root, 'src'))]) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/listening-test|listeningTest|requestCompareSession|voiceCompareClient|discover-voice-compare|CompareLetter/);
    }
  });
});
