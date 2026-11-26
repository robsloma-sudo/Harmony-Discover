/**
 * Marty on Rob's ElevenLabs voice (P-20261126-0102 part 2). Web only.
 *
 * Used only when the SERVER grants the ElevenLabs voice (provider "elevenlabs_agents"). The server keeps
 * the choice: if it switches back to today's OpenAI voice, the app follows with no app change.
 * The official ElevenLabs browser kit opens the microphone, plays Marty and does the turn-taking itself
 * (hands-free; talking over him cuts him off). The kit is downloaded only when this voice is granted.
 */
import { loadElevenLabsStart, type ElevenLabsSession, type ElevenLabsStart } from './elevenlabsKitLoader';

export type { ElevenLabsSession, ElevenLabsStart };

export interface ElevenLabsMartyHooks {
  /** 'speaking' while Marty talks, 'listening' while the guest can talk. */
  onMode(mode: 'speaking' | 'listening'): void;
  onLine(who: 'you' | 'marty', text: string): void;
  /** The connection ended by itself ('closed') or failed ('failed'). Not called after stop(). */
  onClosed(reason: 'closed' | 'failed'): void;
}

export interface ElevenLabsMartyHandle {
  /** Microphone off right now (synchronous); then the conversation ends. Safe to call twice. */
  stop(): void;
  /** 0..1, how loud Marty is right now (0 once stopped). */
  outputVolume(): number;
  /** Typed text to Marty; false if the conversation is not open. */
  sendText(text: string): boolean;
}

export async function connectElevenLabsMarty(opts: {
  conversationToken: string;
  hooks: ElevenLabsMartyHooks;
  startImpl?: ElevenLabsStart;
}): Promise<ElevenLabsMartyHandle> {
  const { conversationToken, hooks } = opts;
  const startSession = opts.startImpl ?? (await loadElevenLabsStart());
  let closed = false;
  let session: ElevenLabsSession | null = null;
  const end = () => {
    const s = session;
    session = null;
    if (!s) return;
    try { s.setMicMuted(true); } catch { /* ending anyway */ }
    void s.endSession().catch(() => undefined);
  };
  const handle: ElevenLabsMartyHandle = {
    stop() { if (closed) return; closed = true; end(); },
    outputVolume() {
      if (closed || !session) return 0;
      try { const v = session.getOutputVolume(); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }
      catch { return 0; }
    },
    sendText(text: string) {
      const t = text.trim();
      if (closed || !session || !t) return false;
      try { session.sendUserMessage(t); return true; } catch { return false; }
    },
  };
  const s = await startSession({
    conversationToken,
    connectionType: 'webrtc',
    onModeChange: ({ mode }) => { if (!closed) hooks.onMode(mode === 'speaking' ? 'speaking' : 'listening'); },
    onMessage: ({ message, source }) => { if (!closed && message?.trim()) hooks.onLine(source === 'user' ? 'you' : 'marty', message); },
    onDisconnect: () => { if (!closed) { closed = true; session = null; hooks.onClosed('closed'); } },
    onError: () => { if (!closed) { closed = true; end(); hooks.onClosed('failed'); } },
  });
  session = s;
  if (closed) end(); // Stop or a failure while connecting: end it at once.
  return handle;
}

/**
 * The kit's output volume is a 0..1 average loudness, larger than the speech RMS the mouth was tuned on
 * (OpenAI path). Scale it into the same range so face L opens about the same amount on both voices.
 */
export function rmsFromElevenLabsVolume(volume: number): number {
  if (!Number.isFinite(volume) || volume <= 0) return 0;
  return Math.min(1, volume) * 0.35;
}
