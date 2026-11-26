/**
 * Loads the official ElevenLabs browser kit on demand (P-20261126-0102; first used by the old listening test, #152).
 * Kept in its own module so tests can mock it: the kit's web entry cannot load under vitest.
 */
export interface ElevenLabsSession {
  endSession(): Promise<void>;
  setMicMuted(isMuted: boolean): void;
  /** 0..1, how loud Marty is right now (drives his mouth). */
  getOutputVolume(): number;
  /** A typed message from the guest, answered like speech. */
  sendUserMessage(text: string): void;
}
export interface ElevenLabsStartOptions {
  conversationToken: string;
  connectionType: 'webrtc';
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (message: string) => void;
  onModeChange?: (prop: { mode: 'speaking' | 'listening' }) => void;
  onMessage?: (props: { message: string; source: 'user' | 'ai' }) => void;
  dynamicVariables?: Record<string, string>;
  clientTools?: Record<string, (parameters: unknown) => Promise<string | void>>;
}
export type ElevenLabsStart = (options: ElevenLabsStartOptions) => Promise<ElevenLabsSession>;

export async function loadElevenLabsStart(): Promise<ElevenLabsStart> {
  // Web entry by path: Metro here ignores package "exports" (see elevenlabsKit.d.ts). The dynamic import keeps
  // the kit in its own web chunk, downloaded only when the server grants the ElevenLabs voice.
  const kit = await import('@elevenlabs/client/dist/platform/web/index.js');
  return (options) => kit.Conversation.startSession(options) as unknown as Promise<ElevenLabsSession>;
}
