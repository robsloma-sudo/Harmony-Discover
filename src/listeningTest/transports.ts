/**
 * Browser transports for the listening test (web only). Self-contained: no app imports except pure logic.
 * Each connect() returns a handle; stop() turns the microphone off first, then closes everything.
 */
import { base64ToBytes, floatToPcm16, functionCallAnswerEvents, geminiAudioMessage, geminiToolResponse, parseGeminiMessage, pcm16ToFloat, resample, type ConnectHint } from './logic';

export const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
/** UNCONFIRMED: the live-calls docs could not be read. Change here only. */
export const GPT_LIVE_CALLS_URL = 'https://api.openai.com/v1/live/calls';
/** UNCONFIRMED: Gemini constrained-token WebSocket endpoint. Change here only. */
export const GEMINI_LIVE_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

const ICE_GRACE_MS = 1500;
const STEP_TIMEOUT_MS = 12000;

export interface TransportHandle { stop(): void }
export interface TransportHooks { onClosed(reason: string): void }

async function getMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(t => { t.enabled = false; t.stop(); });
}

export async function connectWebrtc(opts: { token: string; hint: ConnectHint; hooks: TransportHooks }): Promise<TransportHandle> {
  const { token, hint, hooks } = opts;
  const stream = await getMic();
  const pc = new RTCPeerConnection();
  const audio = new Audio(); audio.autoplay = true;
  let closed = false;
  const stop = () => {
    if (closed) return; closed = true;
    stopStream(stream);
    audio.pause(); audio.srcObject = null;
    try { dc.close(); } catch { /* already closed */ }
    try { pc.close(); } catch { /* already closed */ }
  };
  const dc = pc.createDataChannel('oai-events');
  try {
    pc.ontrack = e => { audio.srcObject = e.streams[0]; void audio.play().catch(() => undefined); };
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    dc.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'response.function_call_arguments.done' && typeof data.call_id === 'string' && dc.readyState === 'open') {
          for (const e of functionCallAnswerEvents(hint, data.call_id)) dc.send(JSON.stringify(e));
        }
      } catch { /* ignore non-JSON */ }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise<void>((resolve, reject) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      let candidates = 0; let done = false;
      const finish = () => { if (done) return; done = true; window.clearTimeout(timeout); window.clearTimeout(grace); resolve(); };
      const timeout = window.setTimeout(() => { if (done) return; done = true; window.clearTimeout(grace); if (candidates > 0) resolve(); else reject(new Error('Network setup timed out.')); }, STEP_TIMEOUT_MS);
      const grace = window.setTimeout(() => { if (candidates > 0) finish(); }, ICE_GRACE_MS);
      pc.onicecandidate = ev => {
        if (!ev.candidate) return;
        candidates += 1;
        if (/ typ (srflx|relay) /.test(` ${ev.candidate.candidate} `)) finish();
      };
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') finish(); };
    });
    const response = await fetch(hint === 'live' ? GPT_LIVE_CALLS_URL : REALTIME_CALLS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/sdp' },
      body: pc.localDescription?.sdp,
    });
    if (!response.ok) { const err = new Error('Connection refused.') as Error & { status?: number }; err.status = response.status; throw err; }
    await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Data channel timed out.')), STEP_TIMEOUT_MS);
      const ready = () => { window.clearTimeout(timeout); resolve(); };
      dc.onopen = ready;
      dc.onerror = () => { window.clearTimeout(timeout); reject(new Error('Data channel failed.')); };
      if (dc.readyState === 'open') ready();
    });
    dc.onclose = () => { if (!closed) { stop(); hooks.onClosed('closed'); } };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' && !closed) { stop(); hooks.onClosed('failed'); } };
    return { stop };
  } catch (e) { stop(); throw e; }
}

export async function connectGemini(opts: { token: string; hooks: TransportHooks }): Promise<TransportHandle> {
  const { token, hooks } = opts;
  const stream = await getMic();
  const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) { stopStream(stream); throw new Error('Audio is not supported here.'); }
  const ctx = new Ctx();
  let closed = false;
  let ws: WebSocket | null = null;
  let proc: ScriptProcessorNode | null = null;
  let playHead = 0;
  const sources = new Set<AudioBufferSourceNode>();
  const stop = () => {
    if (closed) return; closed = true;
    stopStream(stream);
    if (proc) { proc.onaudioprocess = null; try { proc.disconnect(); } catch { /* ok */ } }
    sources.forEach(s => { try { s.stop(); } catch { /* ok */ } });
    sources.clear();
    try { ws?.close(); } catch { /* ok */ }
    void ctx.close().catch(() => undefined);
  };
  const play = (b64: string) => {
    const samples = pcm16ToFloat(base64ToBytes(b64));
    if (!samples.length) return;
    const buf = ctx.createBuffer(1, samples.length, 24000);
    buf.copyToChannel(samples as unknown as Float32Array, 0);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    playHead = Math.max(playHead, ctx.currentTime);
    src.start(playHead); playHead += buf.duration;
    sources.add(src); src.onended = () => sources.delete(src);
  };
  const interrupt = () => { sources.forEach(s => { try { s.stop(); } catch { /* ok */ } }); sources.clear(); playHead = 0; };
  try {
    void ctx.resume?.().catch(() => undefined);
    const socket = new WebSocket(`${GEMINI_LIVE_WS_URL}?access_token=${encodeURIComponent(token)}`);
    ws = socket;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Connection timed out.')), STEP_TIMEOUT_MS);
      socket.onopen = () => socket.send(JSON.stringify({ setup: {} }));
      socket.onerror = () => { window.clearTimeout(timeout); reject(new Error('Connection failed.')); };
      socket.onclose = () => { window.clearTimeout(timeout); if (!closed) reject(new Error('Connection closed.')); };
      socket.onmessage = async ev => {
        try {
          const text = typeof ev.data === 'string' ? ev.data : await (ev.data as Blob).text();
          if (parseGeminiMessage(JSON.parse(text)).setupComplete) { window.clearTimeout(timeout); resolve(); }
        } catch { /* ignore */ }
      };
    });
    socket.onmessage = async ev => {
      try {
        const text = typeof ev.data === 'string' ? ev.data : await (ev.data as Blob).text();
        const m = parseGeminiMessage(JSON.parse(text));
        if (m.interrupted) interrupt();
        m.audio.forEach(play);
        if (m.toolCalls.length && socket.readyState === WebSocket.OPEN) socket.send(geminiToolResponse(m.toolCalls));
      } catch { /* ignore */ }
    };
    socket.onclose = () => { if (!closed) { stop(); hooks.onClosed('closed'); } };
    socket.onerror = () => { if (!closed) { stop(); hooks.onClosed('failed'); } };
    const source = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = ev => {
      if (closed || socket.readyState !== WebSocket.OPEN) return;
      const pcm = floatToPcm16(resample(ev.inputBuffer.getChannelData(0), ctx.sampleRate, 16000));
      socket.send(geminiAudioMessage(pcm));
    };
    source.connect(proc);
    const mute = ctx.createGain(); mute.gain.value = 0; proc.connect(mute); mute.connect(ctx.destination);
    return { stop };
  } catch (e) { stop(); throw e; }
}
