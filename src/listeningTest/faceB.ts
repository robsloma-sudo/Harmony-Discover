/**
 * Option B (photo-real live video face, Anam audio passthrough), web only. Rob-only, listening test screen only.
 * The SDK is imported lazily here so it never loads for guests or on other screens.
 * SDK facts (@anam-ai/js-sdk 4.29.3 .d.ts): createClient(sessionToken) -> client.streamToVideoElement(videoElementId: string),
 * client.createAgentAudioInputStream({ encoding:'pcm_s16le', sampleRate, channels }) -> stream.sendAudioChunk(ArrayBuffer | Uint8Array | base64 string),
 * stream.endSequence(), client.interruptPersona(), client.stopStreaming().
 */
export interface FaceBHandle {
  sendPcm16k(pcm: Int16Array): void;
  endSequence(): void;
  interrupt(): void;
  stop(): void;
  /** The video element's stream, so option A can listen to the very sound Rob hears. */
  mediaStream(): MediaStream | null;
}

export async function startFaceB(opts: {
  sessionToken: string;
  audioInput: { encoding: 'pcm_s16le'; sampleRate: number; channels: number };
  videoElementId: string;
}): Promise<FaceBHandle> {
  const { sessionToken, audioInput, videoElementId } = opts;
  const { createClient } = await import('@anam-ai/js-sdk');
  // disableInputAudio: Anam must never open its own microphone; it only draws the face to Marty's audio.
  const client = createClient(sessionToken, { disableInputAudio: true });
  let stopped = false;
  try {
    await client.streamToVideoElement(videoElementId);
    const input = client.createAgentAudioInputStream({ encoding: audioInput.encoding, sampleRate: audioInput.sampleRate, channels: audioInput.channels });
    return {
      sendPcm16k(pcm) {
        if (stopped || !pcm.length) return;
        try { input.sendAudioChunk(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)); } catch { /* face is preview only */ }
      },
      endSequence() { if (!stopped) { try { input.endSequence(); } catch { /* ok */ } } },
      interrupt() { if (!stopped) { try { client.interruptPersona(); } catch { /* ok */ } } },
      stop() {
        if (stopped) return; stopped = true;
        void Promise.resolve(client.stopStreaming()).catch(() => undefined);
      },
      mediaStream() {
        if (typeof document === 'undefined') return null;
        const v = document.getElementById(videoElementId) as HTMLVideoElement | null;
        const s = v?.srcObject;
        return s && typeof (s as MediaStream).getTracks === 'function' ? (s as MediaStream) : null;
      },
    };
  } catch (e) {
    try { await client.stopStreaming(); } catch { /* ok */ }
    throw e;
  }
}
