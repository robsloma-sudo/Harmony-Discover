import { initialVoiceSnapshot, transitionVoice, type VoiceSnapshot } from './sessionState';
import { requestVoiceSession, type VoiceSessionClientConfig, type VoiceSessionClientResult } from './voiceSessionClient';

/** Platform adapters are injected so permission/audio behavior can be tested without native APIs. */
export interface VoicePlatformAdapter {
  requestMicrophonePermission(): Promise<'granted' | 'denied'>;
  connect(grant: Extract<VoiceSessionClientResult, { ok: true }>['grant']): Promise<void>;
  close(): Promise<void>;
}

export interface VoiceCoordinatorConfig extends VoiceSessionClientConfig {
  platform: VoicePlatformAdapter;
  consentConfirmed: boolean;
}

export interface VoiceCoordinatorSnapshot {
  voice: VoiceSnapshot;
  error?: string;
}

/**
 * Coordinates explicit consent -> OS permission -> ephemeral grant -> media connection.
 * A monotonically increasing operation id prevents late async completions from
 * reviving a session after stop(), interrupt(), or a newer start().
 */
export class VoiceSessionCoordinator {
  private current: VoiceCoordinatorSnapshot = { voice: initialVoiceSnapshot() };
  private operationId = 0;

  constructor(private readonly config: VoiceCoordinatorConfig) {}

  get snapshot(): VoiceCoordinatorSnapshot { return this.current; }

  private send(event: Parameters<typeof transitionVoice>[1]): void {
    this.current = { voice: transitionVoice(this.current.voice, event) };
  }

  private isCurrent(id: number): boolean { return id === this.operationId; }

  async start(): Promise<VoiceCoordinatorSnapshot> {
    // Ignore repeated activation while a request or live session is already in progress.
    // This prevents overlapping permission prompts and competing media connections.
    const state = this.current.voice.state;
    if (state === 'permission_required' || state === 'connecting' || state === 'listening' || state === 'thinking' || state === 'speaking') {
      return this.current;
    }
    const id = ++this.operationId;
    if (!this.config.consentConfirmed) {
      this.current = { voice: this.current.voice, error: 'Review and accept voice consent before activating the microphone.' };
      return this.current;
    }
    this.send({ type: 'ACTIVATE' });

    let permission: 'granted' | 'denied';
    try {
      permission = await this.config.platform.requestMicrophonePermission();
    } catch {
      if (!this.isCurrent(id)) return this.current;
      this.send({ type: 'FAILED' });
      this.current = { ...this.current, error: 'Could not request microphone permission.' };
      return this.current;
    }
    if (!this.isCurrent(id)) return this.current;
    if (permission !== 'granted') {
      this.send({ type: 'PERMISSION_DENIED' });
      this.current = { ...this.current, error: 'Microphone permission was not granted. The camera remains available.' };
      return this.current;
    }

    this.send({ type: 'PERMISSION_GRANTED' });
    const grant = await requestVoiceSession(this.config);
    if (!this.isCurrent(id)) return this.current;
    if (!grant.ok) {
      this.send({ type: 'FAILED' });
      this.current = { ...this.current, error: grant.message };
      return this.current;
    }
    try {
      await this.config.platform.connect(grant.grant);
      if (!this.isCurrent(id)) {
        await this.config.platform.close().catch(() => undefined);
        return this.current;
      }
      this.send({ type: 'SESSION_READY' });
    } catch {
      await this.config.platform.close().catch(() => undefined);
      if (!this.isCurrent(id)) return this.current;
      this.send({ type: 'FAILED' });
      this.current = { ...this.current, error: 'Could not establish the audio connection.' };
    }
    return this.current;
  }

  async stop(): Promise<VoiceCoordinatorSnapshot> {
    ++this.operationId;
    await this.config.platform.close().catch(() => undefined);
    this.send({ type: 'STOP' });
    return this.current;
  }

  async interrupt(): Promise<VoiceCoordinatorSnapshot> {
    ++this.operationId;
    await this.config.platform.close().catch(() => undefined);
    this.send({ type: 'INTERRUPT' });
    return this.current;
  }
}
