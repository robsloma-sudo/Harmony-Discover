// P-20261125-0216 part 2: Marty's face on the scanner, always-on listening and the one off switch.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetMartyPresence, bindMartyOffSwitch, closeMartyFace, getMartyPresence, martyButtonVisible,
  MARTY_ENABLED_KEY, openMarty, setMartyEnabled, subscribeMartyPresence, turnMartyOff,
} from '../src/marty/martyPresence';
import { faceCaption, faceStateFor, microphoneLive, mouthOpenFromLevel, rmsFromBytes } from '../src/marty/faceState';
import { MARTY_REQUESTED_MODE, martySessionConfig } from '../src/marty/martyVoiceConfig';
import { requestVoiceSession } from '../src/voice/voiceSessionClient';
import { VoiceSessionCoordinator } from '../src/voice/voiceSessionCoordinator';
import { TurnController, type RealtimeClientEvent, type TurnPhase } from '../src/voice/turnController';

const URL = 'https://lqqmwqrffelgnbngrkep.supabase.co';
const grant = (mode: string) => ({
  sessionId: 's', provider: 'openai_realtime', ephemeralToken: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(),
  transport: 'webrtc', model: 'm', voice: 'cedar', mode,
});
function fakeFetch(granted: string) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return { ok: true, status: 200, json: async () => grant(granted) };
  }) as unknown as typeof fetch;
  return { bodies, fetchImpl };
}

class MemoryStorage { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } }

describe('the Marty screen asks for always-on listening', () => {
  it('the screen config asks for mode "hands_free"', () => {
    expect(MARTY_REQUESTED_MODE).toBe('hands_free');
    expect(martySessionConfig({ supabaseUrl: URL, accessToken: 'a', screenContext: null }).mode).toBe('hands_free');
  });

  it('the request the screen sends carries mode: "hands_free" (field "mode", not "hands_free")', async () => {
    const { bodies, fetchImpl } = fakeFetch('hands_free');
    const platform = { requestMicrophonePermission: vi.fn(async () => 'granted' as const), connect: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
    const c = new VoiceSessionCoordinator({ ...martySessionConfig({ supabaseUrl: URL, accessToken: 'a', screenContext: null }), fetchImpl, platform, consentConfirmed: true });
    const snap = await c.start();
    expect(snap.voice.state).toBe('listening');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].mode).toBe('hands_free');
    expect(bodies[0]).not.toHaveProperty('hands_free');
    expect(Object.keys(bodies[0]).sort()).toEqual(['consentVersion', 'mode']);
    expect(platform.connect).toHaveBeenCalledWith(expect.objectContaining({ mode: 'hands_free' }));
  });

  it('server stop switch: asked hands_free, granted push_to_talk -> still connects (hold-to-talk fallback)', async () => {
    const { fetchImpl } = fakeFetch('push_to_talk');
    const r = await requestVoiceSession({ supabaseUrl: URL, accessToken: 'a', consentVersion: 'v', mode: 'hands_free', fetchImpl });
    expect(r.ok && r.grant.mode).toBe('push_to_talk');
  });

  it('never runs always-on listening the app did not ask for', async () => {
    const { bodies, fetchImpl } = fakeFetch('hands_free');
    const r = await requestVoiceSession({ supabaseUrl: URL, accessToken: 'a', consentVersion: 'v', fetchImpl });
    expect(bodies[0].mode).toBe('push_to_talk');
    expect(r.ok).toBe(false);
  });
});

describe('Marty button and the one off switch', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    _resetMartyPresence();
  });

  it('Marty is on by default and the button shows over the scanner', () => {
    expect(getMartyPresence()).toEqual({ enabled: true, open: false });
    expect(martyButtonVisible(getMartyPresence(), false)).toBe(true);
  });

  it('tapping the button slides the face up and hides the button; closing the face brings it back', () => {
    openMarty();
    expect(getMartyPresence().open).toBe(true);
    expect(martyButtonVisible(getMartyPresence(), false)).toBe(false);
    closeMartyFace();
    expect(martyButtonVisible(getMartyPresence(), false)).toBe(true);
  });

  it('the button hides while another sheet covers the scanner', () => {
    expect(martyButtonVisible(getMartyPresence(), true)).toBe(false);
  });

  it('off switch: hides Marty and the face, and stops the microphone at once (synchronously)', () => {
    const track = { enabled: true, stopped: false, stop() { this.stopped = true; this.enabled = false; } };
    const stopNow = vi.fn(() => track.stop());
    bindMartyOffSwitch(stopNow);
    openMarty();
    turnMartyOff();
    // No await: the microphone is already off when turnMartyOff returns.
    expect(stopNow).toHaveBeenCalledTimes(1);
    expect(track.enabled).toBe(false);
    expect(track.stopped).toBe(true);
    expect(getMartyPresence()).toEqual({ enabled: false, open: false });
    expect(martyButtonVisible(getMartyPresence(), false)).toBe(false);
    expect(storage.getItem(MARTY_ENABLED_KEY)).toBe('off');
  });

  it('off is remembered on this device; Settings turns him back on', () => {
    setMartyEnabled(false);
    _resetMartyPresence();
    expect(getMartyPresence().enabled).toBe(false);
    const seen: boolean[] = [];
    subscribeMartyPresence(p => seen.push(p.enabled));
    setMartyEnabled(true);
    expect(seen).toEqual([true]);
    expect(martyButtonVisible(getMartyPresence(), false)).toBe(true);
  });

  it('turning him on only does not open the microphone (that needs a tap on Talk to Marty)', () => {
    const stopNow = vi.fn();
    bindMartyOffSwitch(stopNow);
    setMartyEnabled(true);
    expect(stopNow).not.toHaveBeenCalled();
  });

  it('the microphone (and the listening sign) is only live while connected', () => {
    expect(microphoneLive({ connected: false, handsFree: true, phase: 'idle' })).toBe(false);
    expect(microphoneLive({ connected: true, handsFree: true, phase: 'speaking' })).toBe(true);
    expect(microphoneLive({ connected: true, handsFree: false, phase: 'idle' })).toBe(false);
    expect(microphoneLive({ connected: true, handsFree: false, phase: 'talking' })).toBe(true);
  });
});

describe('face states follow the voice session', () => {
  const f = (connected: boolean, phase: TurnPhase, handsFree = true, connecting = false) => faceStateFor({ connected, connecting, handsFree, phase });
  it('maps idle / listening / thinking / talking', () => {
    expect(f(false, 'idle')).toBe('idle');
    expect(f(false, 'idle', true, true)).toBe('thinking');
    expect(f(true, 'idle')).toBe('listening');
    expect(f(true, 'idle', false)).toBe('idle');
    expect(f(true, 'talking')).toBe('listening');
    expect(f(true, 'thinking')).toBe('thinking');
    expect(f(true, 'speaking')).toBe('talking');
    expect(faceCaption('talking', true, true)).toContain('cut in');
  });

  it('mouth opens with his voice level and closes on silence', () => {
    const silence = new Uint8Array(512).fill(128);
    expect(rmsFromBytes(silence)).toBe(0);
    const loud = Uint8Array.from({ length: 512 }, (_, i) => (i % 2 ? 128 + 40 : 128 - 40));
    const rms = rmsFromBytes(loud);
    expect(rms).toBeGreaterThan(0.25);
    let open = 0;
    for (let i = 0; i < 4; i += 1) open = mouthOpenFromLevel(rms, open);
    expect(open).toBeGreaterThan(0.95);
    expect(mouthOpenFromLevel(0.005, 0)).toBe(0);
    let closing = 1;
    for (let i = 0; i < 8; i += 1) closing = mouthOpenFromLevel(0, closing);
    expect(closing).toBe(0);
    const mid = mouthOpenFromLevel(0.08, 0);
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.6);
  });
});

describe('always-on turn taking', () => {
  function setup() {
    const sent: RealtimeClientEvent[] = [];
    const phases: TurnPhase[] = [];
    let t = 0;
    const onBargeIn = vi.fn();
    const turn = new TurnController({ send: e => sent.push(e), now: () => t, onPhase: p => phases.push(p), handsFree: true, onBargeIn });
    return { sent, phases, turn, onBargeIn, tick: (ms: number) => { t += ms; } };
  }

  it('follows the server: speech -> thinking -> Marty talks -> listening, with no talk button', () => {
    const { sent, phases, turn } = setup();
    expect(turn.pressTalk()).toBe(false);
    expect(turn.releaseTalk()).toBe('not_talking');
    turn.handleServerEvent({ type: 'input_audio_buffer.speech_started' });
    turn.handleServerEvent({ type: 'input_audio_buffer.speech_stopped' });
    turn.handleServerEvent({ type: 'response.created' });
    turn.handleServerEvent({ type: 'output_audio_buffer.started' });
    turn.handleServerEvent({ type: 'response.done' });
    turn.handleServerEvent({ type: 'output_audio_buffer.stopped' });
    expect(phases).toEqual(['talking', 'thinking', 'speaking', 'idle']);
    // The server makes the reply itself (create_response): the app sends nothing for a spoken turn.
    expect(sent).toEqual([]);
  });

  it('talking over Marty cuts him off at once and marks what he said as cut off', () => {
    const { sent, phases, turn, onBargeIn, tick } = setup();
    turn.handleServerEvent({ type: 'response.created' });
    turn.handleServerEvent({ type: 'response.output_item.added', item: { type: 'message', id: 'item1' } });
    turn.handleServerEvent({ type: 'output_audio_buffer.started' });
    tick(900);
    turn.handleServerEvent({ type: 'input_audio_buffer.speech_started' });
    expect(onBargeIn).toHaveBeenCalledTimes(1);
    expect(turn.isAudioPlaying).toBe(false);
    expect(turn.isResponseActive).toBe(false);
    expect(turn.wasInterrupted('item1')).toBe(true);
    expect(phases.at(-1)).toBe('talking');
    // interrupt_response on the server cancels; the app does not send a second cancel.
    expect(sent.find(e => e.type === 'response.cancel')).toBeUndefined();
  });

  it('a tool result still asks for the follow-up reply', () => {
    const { sent, turn } = setup();
    turn.sendToolResult('c1', 'Nearby is open.');
    expect(sent.map(e => e.type)).toEqual(['conversation.item.create', 'response.create']);
  });

  it('hold-to-talk sessions ignore the server speech events', () => {
    const phases: TurnPhase[] = [];
    const turn = new TurnController({ send: () => undefined, onPhase: p => phases.push(p) });
    turn.handleServerEvent({ type: 'input_audio_buffer.speech_started' });
    expect(phases).toEqual([]);
  });
});

describe('Marty controls (CEO notes 25 Nov)', () => {
  it('one Stop shows while connected and while still connecting, never when idle', async () => {
    const { showStopButton } = await import('../src/marty/martyControls');
    expect(showStopButton({ connected: true, busy: false })).toBe(true);
    expect(showStopButton({ connected: false, busy: true })).toBe(true);
    expect(showStopButton({ connected: false, busy: false })).toBe(false);
  });
  it('hold-to-talk is only the hidden fallback (push_to_talk granted)', async () => {
    const { showHoldToTalk } = await import('../src/marty/martyControls');
    expect(showHoldToTalk({ connected: true, handsFree: true })).toBe(false);
    expect(showHoldToTalk({ connected: true, handsFree: false })).toBe(true);
    expect(showHoldToTalk({ connected: false, handsFree: false })).toBe(false);
  });
  it('a long press never selects button text on the web, typed text stays selectable', async () => {
    const { NO_SELECT_WEB, SELECT_TEXT_WEB } = await import('../src/marty/martyControls');
    expect(NO_SELECT_WEB.userSelect).toBe('none');
    expect(NO_SELECT_WEB.WebkitUserSelect).toBe('none');
    expect(NO_SELECT_WEB.WebkitTouchCallout).toBe('none');
    expect(SELECT_TEXT_WEB.userSelect).toBe('text');
  });
  it('Stop bumps the stop counter before anything async, so a start still in flight never opens the mic', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'src/marty/useMartyVoice.ts'), 'utf8');
    expect(src).toMatch(/const stop = useCallback\(async \(\) => \{\n\s+stopGenRef\.current \+= 1;\n\s+micOffNow\(\);/);
    expect(src).toContain("if (startGenRef.current !== stopGenRef.current) throw new Error('Marty was stopped.');");
    expect(src).toContain("if (gen !== stopGenRef.current || !getMartyPresence().enabled) { stream.getTracks().forEach(track => track.stop()); return 'denied'; }");
  });
});
