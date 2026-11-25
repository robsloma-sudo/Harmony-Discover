/**
 * Turn-taking for Marty's push-to-talk voice session (OpenAI Realtime, WebRTC data channel).
 *
 * Pure logic, no React and no browser APIs, so it can be unit tested with a fake clock.
 * The panel feeds it every server event and calls press/release/interrupt; the controller
 * decides which client events to send so that:
 *  - only one response is ever active (no double audio, no "already has active response" errors),
 *  - a reply requested while another is still running is queued and sent once, right after it,
 *  - pressing talk while Marty speaks cuts him off at once (barge-in),
 *  - interrupt stops the audio now, cancels the reply and trims what he "said" to what was heard,
 *  - a quick accidental tap does not commit an empty buffer (which errors and used to end the session).
 */

export type RealtimeClientEvent = Record<string, unknown> & { type: string };
export type RealtimeServerEvent = Record<string, unknown> & { type: string };

export type TurnPhase = 'idle' | 'talking' | 'thinking' | 'speaking';

export interface TurnTiming {
  /** ms from releasing the talk button to Marty's first audio. */
  releaseToFirstAudioMs: number | null;
  /** ms from pressing interrupt (or barge-in) to the audio clear being sent. */
  interruptToSilenceMs: number | null;
  /** ms between the previous reply's audio ending and the user pressing talk again. */
  gapBeforeTalkMs: number | null;
}

export interface TurnControllerOptions {
  send: (event: RealtimeClientEvent) => void;
  now?: () => number;
  /** Presses shorter than this are treated as accidental taps: buffer cleared, nothing sent. */
  minTalkMs?: number;
  onPhase?: (phase: TurnPhase) => void;
  onTiming?: (timing: TurnTiming) => void;
  /**
   * Hands-free: the server listens all the time and decides when you stopped talking
   * (it creates Marty's reply itself). pressTalk/releaseTalk are only for push-to-talk.
   */
  handsFree?: boolean;
  /** Hands-free: you started speaking while Marty was talking. Mute his audio now. */
  onBargeIn?: () => void;
}

/** Realtime error codes that are harmless race results, not a broken session. */
const NON_FATAL_ERROR_CODES = new Set([
  'response_cancel_not_active',
  'conversation_already_has_active_response',
  'input_audio_buffer_commit_empty',
  'item_truncate_invalid_item_id',
  'invalid_audio_end_ms',
]);

export function isFatalRealtimeError(event: RealtimeServerEvent): boolean {
  if (event.type !== 'error') return false;
  const err = (event.error && typeof event.error === 'object' ? event.error : {}) as Record<string, unknown>;
  const code = typeof err.code === 'string' ? err.code : '';
  if (NON_FATAL_ERROR_CODES.has(code)) return false;
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  // Older/unknown code spellings of the same races.
  if (message.includes('no active response') || message.includes('already has an active response') || message.includes('buffer too small')) return false;
  return true;
}

export class TurnController {
  private readonly send: (event: RealtimeClientEvent) => void;
  private readonly now: () => number;
  private readonly minTalkMs: number;
  private readonly onPhase?: (phase: TurnPhase) => void;
  private readonly onTiming?: (timing: TurnTiming) => void;
  private readonly handsFree: boolean;
  private readonly onBargeIn?: () => void;

  private responseActive = false;
  private responseQueued = false;
  private audioPlaying = false;
  private audioItemId: string | null = null;
  private audioStartedAt: number | null = null;
  private talkStartedAt: number | null = null;
  private releasedAt: number | null = null;
  private lastAudioEndedAt: number | null = null;
  private pendingGapMs: number | null = null;
  private phaseNow: TurnPhase = 'idle';
  private interruptedItems = new Set<string>();

  constructor(options: TurnControllerOptions) {
    this.send = options.send;
    this.now = options.now ?? (() => Date.now());
    this.minTalkMs = options.minTalkMs ?? 180;
    this.onPhase = options.onPhase;
    this.onTiming = options.onTiming;
    this.handsFree = options.handsFree ?? false;
    this.onBargeIn = options.onBargeIn;
  }

  get isHandsFree(): boolean { return this.handsFree; }

  get phase(): TurnPhase { return this.phaseNow; }
  get isResponseActive(): boolean { return this.responseActive; }
  get isAudioPlaying(): boolean { return this.audioPlaying; }

  private setPhase(phase: TurnPhase) {
    if (phase === this.phaseNow) return;
    this.phaseNow = phase;
    this.onPhase?.(phase);
  }

  /** Talk button pressed. Returns true when the microphone should be opened now. */
  pressTalk(): boolean {
    if (this.phaseNow === 'talking') return false;
    const gap = this.lastAudioEndedAt != null && !this.audioPlaying ? this.now() - this.lastAudioEndedAt : null;
    if (this.audioPlaying || this.responseActive) this.stopMarty();
    // Drop any stray audio left in the input buffer so the new turn starts clean.
    this.send({ type: 'input_audio_buffer.clear' });
    this.talkStartedAt = this.now();
    this.pendingGapMs = gap;
    this.setPhase('talking');
    return true;
  }

  /**
   * Talk button released (call after the short tail delay so the last word is not clipped).
   * Returns 'sent' when a reply was requested, 'too_short' for an accidental tap.
   */
  releaseTalk(): 'sent' | 'too_short' | 'not_talking' {
    if (this.phaseNow !== 'talking' || this.talkStartedAt == null) return 'not_talking';
    const heldMs = this.now() - this.talkStartedAt;
    this.talkStartedAt = null;
    if (heldMs < this.minTalkMs) {
      this.send({ type: 'input_audio_buffer.clear' });
      this.setPhase('idle');
      return 'too_short';
    }
    this.send({ type: 'input_audio_buffer.commit' });
    this.releasedAt = this.now();
    this.setPhase('thinking');
    this.requestResponse();
    return 'sent';
  }

  /** Ask Marty to answer. If a reply is still running, queue exactly one for right after it. */
  requestResponse(): void {
    if (this.responseActive) { this.responseQueued = true; return; }
    this.responseActive = true;
    this.responseQueued = false;
    this.send({ type: 'response.create', response: { output_modalities: ['audio'] } });
    if (this.phaseNow !== 'talking') this.setPhase('thinking');
  }

  /** Typed message. */
  sendText(text: string): void {
    if (this.audioPlaying || this.responseActive) this.stopMarty();
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    this.releasedAt = this.now();
    this.requestResponse();
  }

  /** Tool result back to the model; the follow-up reply is queued behind the current one. */
  sendToolResult(callId: string, output: string): void {
    this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } });
    this.requestResponse();
  }

  /** Interrupt button. Keeps the session open. */
  interrupt(): void {
    this.stopMarty();
    this.setPhase('idle');
  }

  private stopMarty(): void {
    const startedAt = this.now();
    if (this.responseActive) this.send({ type: 'response.cancel' });
    // WebRTC only: drop the audio already buffered on the server side so playback stops now.
    this.send({ type: 'output_audio_buffer.clear' });
    if (this.audioItemId && this.audioStartedAt != null) {
      const played = Math.max(0, Math.round(this.now() - this.audioStartedAt));
      this.send({ type: 'conversation.item.truncate', item_id: this.audioItemId, content_index: 0, audio_end_ms: played });
      this.interruptedItems.add(this.audioItemId);
    }
    this.responseQueued = false;
    this.responseActive = false;
    this.audioPlaying = false;
    this.audioItemId = null;
    this.audioStartedAt = null;
    this.lastAudioEndedAt = this.now();
    this.onTiming?.({ releaseToFirstAudioMs: null, interruptToSilenceMs: this.now() - startedAt, gapBeforeTalkMs: null });
  }

  /** True when a finished transcript belongs to a reply that was cut off (caller may mark it). */
  wasInterrupted(itemId: unknown): boolean {
    return typeof itemId === 'string' && this.interruptedItems.has(itemId);
  }

  /** Feed every server event here. */
  handleServerEvent(event: RealtimeServerEvent): void {
    switch (event.type) {
      case 'input_audio_buffer.speech_started': {
        if (!this.handsFree) break;
        const gap = this.lastAudioEndedAt != null && !this.audioPlaying ? this.now() - this.lastAudioEndedAt : null;
        if (this.audioPlaying || this.responseActive) {
          // Barge-in: the server cancels and trims the reply itself (interrupt_response);
          // mute locally first so Marty goes quiet at once, then forget the old reply.
          const startedAt = this.now();
          this.onBargeIn?.();
          if (this.audioItemId) this.interruptedItems.add(this.audioItemId);
          this.responseActive = false;
          this.responseQueued = false;
          this.audioPlaying = false;
          this.audioItemId = null;
          this.audioStartedAt = null;
          this.lastAudioEndedAt = this.now();
          this.onTiming?.({ releaseToFirstAudioMs: null, interruptToSilenceMs: this.now() - startedAt, gapBeforeTalkMs: null });
        } else {
          this.pendingGapMs = gap;
        }
        this.setPhase('talking');
        break;
      }
      case 'input_audio_buffer.speech_stopped':
        if (!this.handsFree) break;
        this.releasedAt = this.now();
        if (this.phaseNow === 'talking') this.setPhase('thinking');
        break;
      case 'response.created':
        this.responseActive = true;
        break;
      case 'response.output_item.added': {
        const item = (event.item && typeof event.item === 'object' ? event.item : {}) as Record<string, unknown>;
        if (item.type === 'message' && typeof item.id === 'string') this.audioItemId = item.id;
        break;
      }
      case 'output_audio_buffer.started': {
        this.audioPlaying = true;
        this.audioStartedAt = this.now();
        const latency = this.releasedAt != null ? this.audioStartedAt - this.releasedAt : null;
        this.releasedAt = null;
        this.onTiming?.({ releaseToFirstAudioMs: latency, interruptToSilenceMs: null, gapBeforeTalkMs: this.pendingGapMs });
        this.pendingGapMs = null;
        if (this.phaseNow !== 'talking') this.setPhase('speaking');
        break;
      }
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        this.audioPlaying = false;
        this.audioStartedAt = null;
        this.lastAudioEndedAt = this.now();
        if (!this.responseActive && !this.responseQueued && this.phaseNow !== 'talking') this.setPhase('idle');
        break;
      case 'response.done':
        this.responseActive = false;
        if (this.responseQueued) {
          this.responseQueued = false;
          this.requestResponse();
        } else if (!this.audioPlaying && this.phaseNow !== 'talking') {
          this.setPhase('idle');
        }
        break;
      case 'error':
        // A failed response.create race leaves nothing active.
        if (!isFatalRealtimeError(event)) {
          const err = (event.error && typeof event.error === 'object' ? event.error : {}) as Record<string, unknown>;
          if (err.code === 'input_audio_buffer_commit_empty') {
            this.responseActive = false;
            if (this.phaseNow === 'thinking') this.setPhase('idle');
          }
        }
        break;
      default:
        break;
    }
  }
}
