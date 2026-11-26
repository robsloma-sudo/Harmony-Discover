import { describe, expect, it } from 'vitest';
import {
  bytesToInt16, isSecureSocketUrl, parseElevenMessage, pcmRateFromFormat, pongMessage, resampleInt16, userAudioChunkMessage,
} from '../src/listeningTest/elevenlabsProtocol';
import { marksFromAlignment } from '../src/marty/faceRig/visemes';

describe('elevenlabs protocol', () => {
  it('reads pcm rates', () => {
    expect(pcmRateFromFormat('pcm_16000')).toBe(16000);
    expect(pcmRateFromFormat('pcm_24000')).toBe(24000);
    expect(pcmRateFromFormat('ulaw_8000')).toBeNull();
    expect(pcmRateFromFormat(undefined)).toBeNull();
  });
  it('metadata, with defaults', () => {
    expect(parseElevenMessage(JSON.stringify({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { agent_output_audio_format: 'pcm_24000', user_input_audio_format: 'pcm_16000' } })))
      .toEqual({ type: 'metadata', outputRate: 24000, inputRate: 16000 });
    expect(parseElevenMessage('{"type":"conversation_initiation_metadata"}')).toEqual({ type: 'metadata', outputRate: 16000, inputRate: 16000 });
  });
  it('audio with alignment feeds word marks', () => {
    const alignment = { chars: ['H', 'i', ' ', 'y', 'o'], char_start_times_ms: [0, 50, 100, 120, 170], char_durations_ms: [50, 50, 20, 50, 60] };
    const m = parseElevenMessage({ type: 'audio', audio_event: { audio_base_64: 'AAA=', event_id: 3, alignment } });
    expect(m.type === 'audio' && m.eventId).toBe(3);
    expect(m.type === 'audio' && marksFromAlignment(m.alignment)).toEqual([
      { kind: 'word', value: 'Hi', startMs: 0, endMs: 100 }, { kind: 'word', value: 'yo', startMs: 120, endMs: 230 },
    ]);
    expect(parseElevenMessage({ type: 'audio', audio_event: { audio_base_64: 'AAA=' } })).toMatchObject({ type: 'audio', alignment: null, eventId: null });
    expect(parseElevenMessage({ type: 'audio', audio_event: {} })).toEqual({ type: 'ignore' });
  });
  it('text, interruption, ping, junk', () => {
    expect(parseElevenMessage({ type: 'agent_response', agent_response_event: { agent_response: 'Hello' } })).toEqual({ type: 'agent_response', text: 'Hello' });
    expect(parseElevenMessage({ type: 'user_transcript', user_transcription_event: { user_transcript: 'hey' } })).toEqual({ type: 'user_transcript', text: 'hey' });
    expect(parseElevenMessage({ type: 'interruption', interruption_event: { event_id: 7 } })).toEqual({ type: 'interruption', eventId: 7 });
    expect(parseElevenMessage({ type: 'ping', ping_event: { event_id: 9, ping_ms: 40 } })).toEqual({ type: 'ping', eventId: 9, pingMs: 40 });
    for (const j of ['not json', '[]', 'null', '{"type":"zzz"}', 5, null]) expect(parseElevenMessage(j)).toEqual({ type: 'ignore' });
  });
  it('builds pong and mic messages', () => {
    expect(JSON.parse(pongMessage(9))).toEqual({ type: 'pong', event_id: 9 });
    expect(JSON.parse(userAudioChunkMessage(new Uint8Array([1, 0, 2, 0])))).toEqual({ user_audio_chunk: btoa('\x01\x00\x02\x00') });
  });
  it('converts and resamples pcm16', () => {
    const bytes = new Uint8Array([0x01, 0x00, 0xff, 0x7f, 0x05]);
    expect(Array.from(bytesToInt16(bytes))).toEqual([1, 32767]);
    expect(Array.from(resampleInt16(new Int16Array([0, 100, 200, 300]), 24000, 16000))).toHaveLength(2);
    const same = new Int16Array([1, 2]);
    expect(resampleInt16(same, 16000, 16000)).toBe(same);
  });
  it('opens only wss addresses', () => {
    expect(isSecureSocketUrl('wss://api.elevenlabs.io/v1/x?signed_url=1')).toBe(true);
    for (const u of ['ws://x', 'https://x', '', 'wss://', 5, undefined]) expect(isSecureSocketUrl(u)).toBe(false);
  });
});
