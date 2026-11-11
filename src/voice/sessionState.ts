/**
 * UI-independent state machine for the Boston Bartender voice session.
 * This intentionally does not open the microphone or connect to a provider.
 * A real adapter must obtain explicit permission and a server-issued session first.
 */
export type VoiceState =
  | 'offline'
  | 'permission_required'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error';

export type VoiceEvent =
  | { type: 'ACTIVATE' }
  | { type: 'PERMISSION_GRANTED' }
  | { type: 'PERMISSION_DENIED' }
  | { type: 'SESSION_READY' }
  | { type: 'USER_SPEECH_ENDED' }
  | { type: 'RESPONSE_READY' }
  | { type: 'PLAYBACK_ENDED' }
  | { type: 'INTERRUPT' }
  | { type: 'STOP' }
  | { type: 'FAILED' }
  | { type: 'RETRY' };

export interface VoiceSnapshot {
  state: VoiceState;
  microphoneActive: boolean;
  playbackActive: boolean;
  message: string;
}

const snapshot = (state: VoiceState): VoiceSnapshot => ({
  state,
  // Only the listening state may ever report an active microphone.
  microphoneActive: state === 'listening',
  playbackActive: state === 'speaking',
  message: messages[state],
});

const messages: Record<VoiceState, string> = {
  offline: 'VOICE OFFLINE',
  permission_required: 'MICROPHONE PERMISSION REQUIRED',
  connecting: 'CONNECTING TO THE BARTENDER',
  listening: 'LISTENING',
  thinking: 'LET ME THINK',
  speaking: 'THE BARTENDER IS SPEAKING',
  interrupted: 'PLAYBACK INTERRUPTED',
  error: 'VOICE CONNECTION ERROR',
};

const allowed: Record<VoiceState, VoiceEvent['type'][]> = {
  offline: ['ACTIVATE'],
  permission_required: ['PERMISSION_GRANTED', 'PERMISSION_DENIED', 'INTERRUPT', 'STOP'],
  connecting: ['SESSION_READY', 'FAILED', 'INTERRUPT', 'STOP'],
  listening: ['USER_SPEECH_ENDED', 'INTERRUPT', 'FAILED', 'STOP'],
  thinking: ['RESPONSE_READY', 'FAILED', 'STOP'],
  speaking: ['PLAYBACK_ENDED', 'INTERRUPT', 'FAILED', 'STOP'],
  interrupted: ['ACTIVATE', 'STOP'],
  error: ['ACTIVATE', 'RETRY', 'STOP'],
};

export function transitionVoice(snapshotNow: VoiceSnapshot, event: VoiceEvent): VoiceSnapshot {
  const current = snapshotNow.state;
  if (!allowed[current].includes(event.type)) return snapshot(current);

  switch (event.type) {
    case 'ACTIVATE': return snapshot('permission_required');
    case 'PERMISSION_GRANTED': return snapshot('connecting');
    case 'PERMISSION_DENIED': return snapshot('offline');
    case 'SESSION_READY': return snapshot('listening');
    case 'USER_SPEECH_ENDED': return snapshot('thinking');
    case 'RESPONSE_READY': return snapshot('speaking');
    case 'PLAYBACK_ENDED': return snapshot('listening');
    case 'INTERRUPT': return snapshot('interrupted');
    case 'FAILED': return snapshot('error');
    case 'RETRY': return snapshot('connecting');
    case 'STOP': return snapshot('offline');
  }
}

export const initialVoiceSnapshot = (): VoiceSnapshot => snapshot('offline');
