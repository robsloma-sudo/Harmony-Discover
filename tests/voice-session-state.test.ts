import { describe, expect, it } from 'vitest';
import { initialVoiceSnapshot, transitionVoice } from '../src/voice/sessionState';

describe('bartender voice state machine', () => {
  it('never marks the microphone active before permission and session readiness', () => {
    let s = initialVoiceSnapshot();
    expect(s.microphoneActive).toBe(false);
    s = transitionVoice(s, { type: 'ACTIVATE' });
    expect(s.state).toBe('permission_required');
    expect(s.microphoneActive).toBe(false);
    s = transitionVoice(s, { type: 'PERMISSION_GRANTED' });
    expect(s.state).toBe('connecting');
    expect(s.microphoneActive).toBe(false);
    s = transitionVoice(s, { type: 'SESSION_READY' });
    expect(s.state).toBe('listening');
    expect(s.microphoneActive).toBe(true);
  });

  it('models a complete turn and returns to listening after playback', () => {
    let s = initialVoiceSnapshot();
    for (const type of ['ACTIVATE', 'PERMISSION_GRANTED', 'SESSION_READY', 'USER_SPEECH_ENDED', 'RESPONSE_READY', 'PLAYBACK_ENDED'] as const) {
      s = transitionVoice(s, { type });
    }
    expect(s.state).toBe('listening');
    expect(s.playbackActive).toBe(false);
  });

  it('stops microphone and playback immediately on interrupt or stop', () => {
    let s = initialVoiceSnapshot();
    for (const type of ['ACTIVATE', 'PERMISSION_GRANTED', 'SESSION_READY', 'USER_SPEECH_ENDED', 'RESPONSE_READY'] as const) {
      s = transitionVoice(s, { type });
    }
    expect(s.playbackActive).toBe(true);
    s = transitionVoice(s, { type: 'INTERRUPT' });
    expect(s.state).toBe('interrupted');
    expect(s.playbackActive).toBe(false);
    expect(s.microphoneActive).toBe(false);
    s = transitionVoice(s, { type: 'STOP' });
    expect(s.state).toBe('offline');
  });


  it('allows interrupt while microphone permission is pending', () => {
    let s = transitionVoice(initialVoiceSnapshot(), { type: 'ACTIVATE' });
    s = transitionVoice(s, { type: 'INTERRUPT' });
    expect(s.state).toBe('interrupted');
    expect(s.microphoneActive).toBe(false);
  });

  it('allows interrupt while the audio connection is being established', () => {
    let s = transitionVoice(initialVoiceSnapshot(), { type: 'ACTIVATE' });
    s = transitionVoice(s, { type: 'PERMISSION_GRANTED' });
    s = transitionVoice(s, { type: 'INTERRUPT' });
    expect(s.state).toBe('interrupted');
    expect(s.microphoneActive).toBe(false);
    expect(s.playbackActive).toBe(false);
  });

  it('ignores invalid transitions', () => {
    const s = transitionVoice(initialVoiceSnapshot(), { type: 'RESPONSE_READY' });
    expect(s.state).toBe('offline');
  });
});
