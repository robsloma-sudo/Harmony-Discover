import { describe, expect, it } from 'vitest';
import { TurnController, isFatalRealtimeError, type RealtimeClientEvent, type TurnTiming } from '../src/voice/turnController';

function setup() {
  let t = 1_000;
  const sent: RealtimeClientEvent[] = [];
  const timings: TurnTiming[] = [];
  const phases: string[] = [];
  const c = new TurnController({
    send: e => sent.push(e), now: () => t,
    onTiming: x => timings.push(x), onPhase: p => phases.push(p),
  });
  const advance = (ms: number) => { t += ms; };
  const types = () => sent.map(e => e.type);
  return { c, sent, timings, phases, advance, types };
}

/** Plays one full reply from the server side. */
function serverReply(c: TurnController, advance: (ms: number) => void, itemId = 'item_1', speakMs = 2000) {
  c.handleServerEvent({ type: 'response.created' });
  c.handleServerEvent({ type: 'response.output_item.added', item: { type: 'message', id: itemId } });
  advance(50);
  c.handleServerEvent({ type: 'output_audio_buffer.started' });
  advance(speakMs);
  c.handleServerEvent({ type: 'response.done' });
  c.handleServerEvent({ type: 'output_audio_buffer.stopped' });
}

describe('TurnController (Marty push-to-talk)', () => {
  it('talk -> release commits once and asks for exactly one reply', () => {
    const { c, advance, types } = setup();
    expect(c.pressTalk()).toBe(true);
    advance(900);
    expect(c.releaseTalk()).toBe('sent');
    expect(types()).toEqual(['input_audio_buffer.clear', 'input_audio_buffer.commit', 'response.create']);
    expect(c.phase).toBe('thinking');
  });

  it('logs the time from release to first audio, and the gap before the next turn', () => {
    const { c, advance, timings } = setup();
    c.pressTalk(); advance(800); c.releaseTalk();
    advance(650);
    c.handleServerEvent({ type: 'response.created' });
    c.handleServerEvent({ type: 'output_audio_buffer.started' });
    expect(timings.at(-1)?.releaseToFirstAudioMs).toBe(650);
    advance(1500);
    c.handleServerEvent({ type: 'response.done' });
    c.handleServerEvent({ type: 'output_audio_buffer.stopped' });
    advance(400);
    c.pressTalk(); advance(700); c.releaseTalk();
    advance(500);
    c.handleServerEvent({ type: 'response.created' });
    c.handleServerEvent({ type: 'output_audio_buffer.started' });
    expect(timings.at(-1)).toMatchObject({ releaseToFirstAudioMs: 500, gapBeforeTalkMs: 400 });
  });

  it('a quick accidental tap sends nothing to Marty (no empty-commit error)', () => {
    const { c, advance, types } = setup();
    c.pressTalk(); advance(60);
    expect(c.releaseTalk()).toBe('too_short');
    expect(types()).not.toContain('input_audio_buffer.commit');
    expect(types()).not.toContain('response.create');
    expect(c.phase).toBe('idle');
  });

  it('interrupt mid-sentence stops audio at once, cancels the reply and trims it to what was heard', () => {
    const { c, advance, sent, types, timings } = setup();
    c.pressTalk(); advance(500); c.releaseTalk();
    c.handleServerEvent({ type: 'response.created' });
    c.handleServerEvent({ type: 'response.output_item.added', item: { type: 'message', id: 'item_9' } });
    c.handleServerEvent({ type: 'output_audio_buffer.started' });
    advance(1200);
    const before = sent.length;
    c.interrupt();
    expect(types().slice(before)).toEqual(['response.cancel', 'output_audio_buffer.clear', 'conversation.item.truncate']);
    expect(sent.at(-1)).toMatchObject({ item_id: 'item_9', content_index: 0, audio_end_ms: 1200 });
    expect(timings.at(-1)?.interruptToSilenceMs).toBe(0);
    expect(c.isAudioPlaying).toBe(false);
    expect(c.wasInterrupted('item_9')).toBe(true);
    expect(c.phase).toBe('idle');
  });

  it('pressing talk while Marty speaks cuts him off (barge-in) and keeps the session for the new turn', () => {
    const { c, advance, types } = setup();
    c.pressTalk(); advance(500); c.releaseTalk();
    c.handleServerEvent({ type: 'response.created' });
    c.handleServerEvent({ type: 'response.output_item.added', item: { type: 'message', id: 'a' } });
    c.handleServerEvent({ type: 'output_audio_buffer.started' });
    advance(800);
    c.pressTalk();
    expect(types().slice(-4)).toEqual(['response.cancel', 'output_audio_buffer.clear', 'conversation.item.truncate', 'input_audio_buffer.clear']);
    expect(c.phase).toBe('talking');
    advance(600);
    expect(c.releaseTalk()).toBe('sent');
    expect(types().at(-1)).toBe('response.create');
  });

  it('never sends two replies at once: a tool follow-up waits for the running reply to finish', () => {
    const { c, advance, types } = setup();
    c.pressTalk(); advance(500); c.releaseTalk();
    c.handleServerEvent({ type: 'response.created' });
    c.sendToolResult('call_1', 'Opened Nearby.');
    c.sendToolResult('call_2', 'Set radius.');
    expect(types().filter(t => t === 'response.create')).toHaveLength(1);
    c.handleServerEvent({ type: 'response.done' });
    expect(types().filter(t => t === 'response.create')).toHaveLength(2);
    c.handleServerEvent({ type: 'response.created' });
    c.handleServerEvent({ type: 'response.done' });
    expect(types().filter(t => t === 'response.create')).toHaveLength(2);
  });

  it('full talk / reply / interrupt / talk loop sends no overlapping replies', () => {
    const { c, advance, types } = setup();
    c.pressTalk(); advance(700); c.releaseTalk();
    serverReply(c, advance, 'r1');
    c.pressTalk(); advance(700); c.releaseTalk();
    c.handleServerEvent({ type: 'response.created' });
    c.handleServerEvent({ type: 'output_audio_buffer.started' });
    advance(300); c.interrupt();
    c.handleServerEvent({ type: 'response.done' });
    c.pressTalk(); advance(700); c.releaseTalk();
    let active = 0; let maxActive = 0;
    for (const t of types()) {
      if (t === 'response.create') { active += 1; maxActive = Math.max(maxActive, active); }
      if (t === 'response.cancel') active = 0;
      if (t === 'input_audio_buffer.commit') active = Math.min(active, 0);
    }
    expect(maxActive).toBe(1);
  });

  it('harmless race errors do not end the session; real ones do', () => {
    expect(isFatalRealtimeError({ type: 'error', error: { code: 'response_cancel_not_active' } })).toBe(false);
    expect(isFatalRealtimeError({ type: 'error', error: { code: 'conversation_already_has_active_response' } })).toBe(false);
    expect(isFatalRealtimeError({ type: 'error', error: { code: 'input_audio_buffer_commit_empty' } })).toBe(false);
    expect(isFatalRealtimeError({ type: 'error', error: { message: 'Cancellation failed: no active response found' } })).toBe(false);
    expect(isFatalRealtimeError({ type: 'error', error: { code: 'session_expired' } })).toBe(true);
    expect(isFatalRealtimeError({ type: 'response.done' })).toBe(false);
  });
});

describe('TurnController hands-free (server listens, app never sends replies for speech)', () => {
  function handsFree() {
    const sent: RealtimeClientEvent[] = [];
    const phases: string[] = [];
    let bargeIns = 0;
    let t = 1000;
    const c = new TurnController({
      send: e => sent.push(e), now: () => t, handsFree: true,
      onPhase: p => phases.push(p), onBargeIn: () => { bargeIns += 1; },
    });
    return { c, sent, phases, tick: (ms: number) => { t += ms; }, bargeIns: () => bargeIns };
  }

  it('speech start/stop moves talking -> thinking without sending response.create', () => {
    const h = handsFree();
    h.c.handleServerEvent({ type: 'input_audio_buffer.speech_started' });
    expect(h.c.phase).toBe('talking');
    h.c.handleServerEvent({ type: 'input_audio_buffer.speech_stopped' });
    expect(h.c.phase).toBe('thinking');
    h.c.handleServerEvent({ type: 'response.created' });
    h.c.handleServerEvent({ type: 'output_audio_buffer.started' });
    expect(h.c.phase).toBe('speaking');
    h.c.handleServerEvent({ type: 'response.done' });
    h.c.handleServerEvent({ type: 'output_audio_buffer.stopped' });
    expect(h.c.phase).toBe('idle');
    expect(h.sent.filter(e => e.type === 'response.create')).toHaveLength(0);
    expect(h.bargeIns()).toBe(0);
  });

  it('speaking over Marty mutes him at once and marks his reply cut off', () => {
    const h = handsFree();
    h.c.handleServerEvent({ type: 'response.created' });
    h.c.handleServerEvent({ type: 'response.output_item.added', item: { type: 'message', id: 'item_1' } });
    h.c.handleServerEvent({ type: 'output_audio_buffer.started' });
    h.tick(800);
    h.c.handleServerEvent({ type: 'input_audio_buffer.speech_started' });
    expect(h.bargeIns()).toBe(1);
    expect(h.c.phase).toBe('talking');
    expect(h.c.isAudioPlaying).toBe(false);
    expect(h.c.isResponseActive).toBe(false);
    expect(h.c.wasInterrupted('item_1')).toBe(true);
    // The server's own cancel of the old reply must not knock us out of talking.
    h.c.handleServerEvent({ type: 'response.done' });
    h.c.handleServerEvent({ type: 'output_audio_buffer.cleared' });
    expect(h.c.phase).toBe('talking');
  });

  it('push-to-talk controllers ignore server speech events', () => {
    const sent: RealtimeClientEvent[] = [];
    const c = new TurnController({ send: e => sent.push(e) });
    c.handleServerEvent({ type: 'input_audio_buffer.speech_started' });
    expect(c.phase).toBe('idle');
    expect(c.isHandsFree).toBe(false);
  });
});
