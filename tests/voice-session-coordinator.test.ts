import { describe, expect, it, vi } from 'vitest';
import { VoiceSessionCoordinator, type VoicePlatformAdapter } from '../src/voice/voiceSessionCoordinator';

const base = {
  supabaseUrl: 'https://lqqmwqrffelgnbngrkep.supabase.co',
  accessToken: 'test-access-token',
  consentVersion: 'voice-consent-2026-11',
  fetchImpl: vi.fn(async () => new Response(JSON.stringify({
    sessionId: 's1', provider: 'openai_realtime', ephemeralToken: 'ephemeral',
    expiresAt: new Date(Date.now() + 60_000).toISOString(), transport: 'webrtc', model: 'test-model', voice: 'unselected',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
};

function platform(permission: 'granted' | 'denied' = 'granted'): VoicePlatformAdapter {
  return { requestMicrophonePermission: vi.fn(async () => permission), connect: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
}

describe('VoiceSessionCoordinator', () => {
  it('does not request microphone before explicit consent', async () => {
    const p = platform();
    const c = new VoiceSessionCoordinator({ ...base, platform: p, consentConfirmed: false });
    const result = await c.start();
    expect(result.voice.state).toBe('offline');
    expect(p.requestMicrophonePermission).not.toHaveBeenCalled();
  });

  it('does not claim listening when permission is denied', async () => {
    const p = platform('denied');
    const c = new VoiceSessionCoordinator({ ...base, platform: p, consentConfirmed: true });
    const result = await c.start();
    expect(result.voice.state).toBe('offline');
    expect(result.voice.microphoneActive).toBe(false);
    expect(base.fetchImpl).not.toHaveBeenCalled();
  });

  it('enters listening only after grant and transport connection', async () => {
    const p = platform();
    const c = new VoiceSessionCoordinator({ ...base, platform: p, consentConfirmed: true });
    const result = await c.start();
    expect(result.voice.state).toBe('listening');
    expect(result.voice.microphoneActive).toBe(true);
    expect(p.connect).toHaveBeenCalledOnce();
  });


  it('does not create a session when stopped while permission is pending', async () => {
    let resolvePermission!: (value: 'granted' | 'denied') => void;
    const pendingPermission = new Promise<'granted' | 'denied'>(resolve => { resolvePermission = resolve; });
    const p: VoicePlatformAdapter = {
      requestMicrophonePermission: vi.fn(() => pendingPermission),
      connect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const fetchSpy = vi.fn(base.fetchImpl);
    const c = new VoiceSessionCoordinator({ ...base, fetchImpl: fetchSpy, platform: p, consentConfirmed: true });
    const starting = c.start();
    await c.stop();
    resolvePermission('granted');
    const result = await starting;
    expect(result.voice.state).toBe('offline');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(p.connect).not.toHaveBeenCalled();
    expect(p.close).toHaveBeenCalled();
  });

  it('closes a connection that resolves after the user stops', async () => {
    let resolveConnect!: () => void;
    const pendingConnect = new Promise<void>(resolve => { resolveConnect = resolve; });
    const p: VoicePlatformAdapter = {
      requestMicrophonePermission: vi.fn(async (): Promise<'granted' | 'denied'> => 'granted'),
      connect: vi.fn(() => pendingConnect),
      close: vi.fn(async () => undefined),
    };
    const c = new VoiceSessionCoordinator({ ...base, platform: p, consentConfirmed: true });
    const starting = c.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await c.stop();
    resolveConnect();
    const result = await starting;
    expect(result.voice.state).toBe('offline');
    expect(p.close).toHaveBeenCalled();
  });

  it('does not launch duplicate startup while a permission prompt is pending', async () => {
    let resolvePermission!: (value: 'granted' | 'denied') => void;
    const pendingPermission = new Promise<'granted' | 'denied'>(resolve => { resolvePermission = resolve; });
    const p: VoicePlatformAdapter = {
      requestMicrophonePermission: vi.fn(() => pendingPermission),
      connect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const c = new VoiceSessionCoordinator({ ...base, platform: p, consentConfirmed: true });
    const first = c.start();
    const second = await c.start();
    expect(second.voice.state).toBe('permission_required');
    expect(p.requestMicrophonePermission).toHaveBeenCalledOnce();
    resolvePermission('denied');
    await first;
  });

  it('can retry after a failed session request', async () => {
    const p = platform();
    const fetchSequence = vi.fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sessionId: 's2', provider: 'openai_realtime', ephemeralToken: 'ephemeral-2',
        expiresAt: new Date(Date.now() + 60_000).toISOString(), transport: 'webrtc', model: 'test-model', voice: 'unselected',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const c = new VoiceSessionCoordinator({ ...base, fetchImpl: fetchSequence, platform: p, consentConfirmed: true });
    const failed = await c.start();
    expect(failed.voice.state).toBe('error');
    const retried = await c.start();
    expect(retried.voice.state).toBe('listening');
    expect(fetchSequence).toHaveBeenCalledTimes(2);
  });


  it('shows interrupted when cancelled during pending microphone permission', async () => {
    let resolvePermission!: (value: 'granted' | 'denied') => void;
    const pendingPermission = new Promise<'granted' | 'denied'>(resolve => { resolvePermission = resolve; });
    const p: VoicePlatformAdapter = {
      requestMicrophonePermission: vi.fn(() => pendingPermission),
      connect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const c = new VoiceSessionCoordinator({ ...base, platform: p, consentConfirmed: true });
    const starting = c.start();
    const interrupted = await c.interrupt();
    expect(interrupted.voice.state).toBe('interrupted');
    resolvePermission('granted');
    await starting;
    expect(c.snapshot.voice.state).toBe('interrupted');
    expect(p.connect).not.toHaveBeenCalled();
  });

  it('shows interrupted when cancelled during connection setup', async () => {
    let resolveConnect!: () => void;
    const pendingConnect = new Promise<void>(resolve => { resolveConnect = resolve; });
    const p: VoicePlatformAdapter = {
      requestMicrophonePermission: vi.fn(async (): Promise<'granted' | 'denied'> => 'granted'),
      connect: vi.fn(() => pendingConnect),
      close: vi.fn(async () => undefined),
    };
    const c = new VoiceSessionCoordinator({ ...base, platform: p, consentConfirmed: true });
    const starting = c.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const interrupted = await c.interrupt();
    expect(interrupted.voice.state).toBe('interrupted');
    resolveConnect();
    await starting;
    expect(c.snapshot.voice.state).toBe('interrupted');
    expect(p.close).toHaveBeenCalled();
  });

  it('closes media resources on stop', async () => {
    const p = platform();
    const c = new VoiceSessionCoordinator({ ...base, platform: p, consentConfirmed: true });
    await c.start();
    const result = await c.stop();
    expect(result.voice.state).toBe('offline');
    expect(result.voice.microphoneActive).toBe(false);
    expect(p.close).toHaveBeenCalled();
  });
});
