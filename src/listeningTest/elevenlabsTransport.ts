/**
 * ElevenLabs voice for the hidden listening test only (P-20261126-0004 part 2). Web only.
 * The official ElevenLabs browser kit is loaded on demand, only when an ElevenLabs start is pressed,
 * so guests and the normal Marty never download it. The server already gave the ElevenLabs agent
 * today's Marty script and voice, so nothing is overridden here: we only pass the one-conversation token.
 */
import type { TransportHandle, TransportHooks } from './transports';
import { loadElevenLabsStart, type ElevenLabsSession, type ElevenLabsStart } from './elevenlabsKitLoader';

export type { ElevenLabsSession, ElevenLabsStart };

export async function connectElevenLabs(opts: {
  conversationToken: string;
  hooks: TransportHooks;
  startImpl?: ElevenLabsStart;
}): Promise<TransportHandle> {
  const { conversationToken, hooks } = opts;
  const startSession = opts.startImpl ?? (await loadElevenLabsStart());
  let closed = false;
  let session: ElevenLabsSession | null = null;
  const end = () => { const s = session; session = null; if (s) void s.endSession().catch(() => undefined); };
  const handle: TransportHandle = { stop() { if (closed) return; closed = true; end(); } };
  const s = await startSession({
    conversationToken,
    connectionType: 'webrtc',
    onDisconnect: () => { if (!closed) { closed = true; session = null; hooks.onClosed('closed'); } },
    onError: () => { if (!closed) { closed = true; end(); hooks.onClosed('failed'); } },
  });
  session = s;
  if (closed) end(); // hung up while connecting: end it at once
  return handle;
}
