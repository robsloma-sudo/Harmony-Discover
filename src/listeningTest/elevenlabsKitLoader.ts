/** Loads the official ElevenLabs browser kit on demand (listening test only, P-20261126-0004 part 2). */
export interface ElevenLabsSession { endSession(): Promise<void> }
export type ElevenLabsStart = (options: {
  conversationToken: string;
  connectionType: 'webrtc';
  onDisconnect?: () => void;
  onError?: (message: string) => void;
}) => Promise<ElevenLabsSession>;

export async function loadElevenLabsStart(): Promise<ElevenLabsStart> {
  // Web entry by path: Metro here ignores package "exports" (see elevenlabsKit.d.ts). The dynamic import keeps
  // the kit in its own web chunk, downloaded only when an ElevenLabs start is pressed.
  const kit = await import('@elevenlabs/client/dist/platform/web/index.js');
  return (options) => kit.Conversation.startSession(options) as Promise<ElevenLabsSession>;
}
