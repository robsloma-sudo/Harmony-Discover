import { describe, expect, it } from 'vitest';
import { validateVoiceSessionGrant } from '../src/voice/sessionContract';

const now = Date.parse('2026-11-09T12:00:00.000Z');
const valid = {
  sessionId: 'session-123', provider: 'openai_realtime', ephemeralToken: 'ephemeral-only',
  expiresAt: '2026-11-09T12:05:00.000Z', transport: 'webrtc', model: 'realtime-model', voice: 'selected-voice',
};

describe('voice session grant contract', () => {
  it('accepts a complete short-lived grant', () => {
    expect(validateVoiceSessionGrant(valid, now).ok).toBe(true);
  });
  it('rejects missing credentials and malformed responses', () => {
    expect(validateVoiceSessionGrant(null, now).ok).toBe(false);
    expect(validateVoiceSessionGrant({ ...valid, ephemeralToken: '' }, now).ok).toBe(false);
  });
  it('rejects expired or excessively long grants', () => {
    expect(validateVoiceSessionGrant({ ...valid, expiresAt: '2026-11-09T11:59:00.000Z' }, now).ok).toBe(false);
    expect(validateVoiceSessionGrant({ ...valid, expiresAt: '2026-11-09T13:00:00.000Z' }, now).ok).toBe(false);
  });
  it('rejects unsupported transports and providers', () => {
    expect(validateVoiceSessionGrant({ ...valid, transport: 'raw-audio' }, now).ok).toBe(false);
    expect(validateVoiceSessionGrant({ ...valid, provider: 'unknown' }, now).ok).toBe(false);
  });
});
