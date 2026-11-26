/**
 * ElevenLabs Agents over a websocket (web only). Unlike WebRTC this carries Marty's sound chunks and letter timing,
 * which the phone's face animation (option A) and the photo-real face service (option B) both need.
 * stop() turns the microphone off first, then closes the socket and audio.
 */
import { base64ToBytes, floatToPcm16, pcm16ToFloat, resample } from './logic';
import { marksFromAlignment } from '../marty/faceRig/visemes';
import {
  DEFAULT_ELEVEN_OUTPUT_RATE, ELEVEN_INPUT_RATE, bytesToInt16, isSecureSocketUrl, parseElevenMessage, pongMessage,
  resampleInt16, userAudioChunkMessage,
} from './elevenlabsProtocol';
import type { TransportHandle, TransportHooks } from './transports';

const STEP_TIMEOUT_MS = 12000;

export async function connectElevenLabsWs(opts: { signedUrl: string; hooks: TransportHooks; muteOutput?: boolean }): Promise<TransportHandle> {
  const { signedUrl, hooks, muteOutput } = opts;
  if (!isSecureSocketUrl(signedUrl)) throw new Error('The voice address is not secure.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  const closeMic = () => { stream.getTracks().forEach(t => { t.enabled = false; t.stop(); }); };
  const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) { closeMic(); throw new Error('Audio is not supported here.'); }
  const ctx = new Ctx();
  let closed = false;
  let ws: WebSocket | null = null;
  let proc: ScriptProcessorNode | null = null;
  let playHead = 0;
  let outputRate = DEFAULT_ELEVEN_OUTPUT_RATE;
  let inputRate = ELEVEN_INPUT_RATE;
  const sources = new Set<AudioBufferSourceNode>();
  let analyser: AnalyserNode | null = null;
  if (hooks.onVoiceAnalyser) {
    try {
      analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.3;
      hooks.onVoiceAnalyser(analyser);
    } catch { analyser = null; }
  }
  // With muted output the analyser still needs a path to the destination in some browsers: a silent gain.
  if (muteOutput && analyser) {
    try { const silent = ctx.createGain(); silent.gain.value = 0; analyser.connect(silent); silent.connect(ctx.destination); } catch { /* ok */ }
  }
  const stop = () => {
    if (closed) return; closed = true;
    closeMic();
    if (proc) { proc.onaudioprocess = null; try { proc.disconnect(); } catch { /* ok */ } }
    sources.forEach(s => { try { s.stop(); } catch { /* ok */ } });
    sources.clear();
    try { ws?.close(); } catch { /* ok */ }
    void ctx.close().catch(() => undefined);
  };
  const playChunk = (b64: string, alignment: Parameters<typeof marksFromAlignment>[0]) => {
    const pcm = bytesToInt16(base64ToBytes(b64));
    if (!pcm.length) return;
    const samples = pcm16ToFloat(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    const buf = ctx.createBuffer(1, samples.length, outputRate);
    buf.copyToChannel(samples as unknown as Float32Array, 0);
    const src = ctx.createBufferSource(); src.buffer = buf;
    if (!muteOutput) src.connect(ctx.destination);
    if (analyser) { try { src.connect(analyser); } catch { /* preview only */ } }
    const startCtx = Math.max(playHead, ctx.currentTime);
    // Convert the audio-clock start time to performance.now() time (the face driver's clock).
    const startsAt = performance.now() + Math.max(0, startCtx - ctx.currentTime) * 1000;
    src.start(startCtx); playHead = startCtx + buf.duration;
    sources.add(src); src.onended = () => sources.delete(src);
    try { hooks.onSpeechMarks?.(marksFromAlignment(alignment), startsAt); } catch { /* preview only */ }
    try {
      hooks.onVoicePcm16k?.(outputRate === 16000 ? pcm : resampleInt16(pcm, outputRate, 16000));
    } catch { /* preview only */ }
  };
  const interrupt = () => { sources.forEach(s => { try { s.stop(); } catch { /* ok */ } }); sources.clear(); playHead = 0; };
  try {
    void ctx.resume?.().catch(() => undefined);
    const socket = new WebSocket(signedUrl);
    ws = socket;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Connection timed out.')), STEP_TIMEOUT_MS);
      socket.onopen = () => { window.clearTimeout(timeout); resolve(); };
      socket.onerror = () => { window.clearTimeout(timeout); reject(new Error('Connection failed.')); };
      socket.onclose = () => { window.clearTimeout(timeout); if (!closed) reject(new Error('Connection closed.')); };
    });
    socket.onmessage = async ev => {
      try {
        const text = typeof ev.data === 'string' ? ev.data : await (ev.data as Blob).text();
        const m = parseElevenMessage(text);
        if (m.type === 'metadata') { outputRate = m.outputRate; inputRate = m.inputRate; }
        else if (m.type === 'audio') playChunk(m.base64, m.alignment);
        else if (m.type === 'agent_response') { try { hooks.onMartyText?.(`${m.text} `); hooks.onMartyTurnDone?.(); } catch { /* preview only */ } }
        else if (m.type === 'interruption') {
          interrupt();
          try { hooks.onMartyInterrupted?.(); } catch { /* preview only */ }
        } else if (m.type === 'ping' && socket.readyState === WebSocket.OPEN) {
          const send = () => { if (!closed && socket.readyState === WebSocket.OPEN) socket.send(pongMessage(m.eventId)); };
          if (m.pingMs > 0) window.setTimeout(send, m.pingMs); else send();
        }
      } catch { /* ignore */ }
    };
    socket.onclose = () => { if (!closed) { stop(); hooks.onClosed('closed'); } };
    socket.onerror = () => { if (!closed) { stop(); hooks.onClosed('failed'); } };
    const source = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = ev => {
      if (closed || socket.readyState !== WebSocket.OPEN) return;
      const pcm = floatToPcm16(resample(ev.inputBuffer.getChannelData(0), ctx.sampleRate, inputRate));
      socket.send(userAudioChunkMessage(pcm));
    };
    source.connect(proc);
    const mute = ctx.createGain(); mute.gain.value = 0; proc.connect(mute); mute.connect(ctx.destination);
    return { stop };
  } catch (e) { stop(); throw e; }
}
