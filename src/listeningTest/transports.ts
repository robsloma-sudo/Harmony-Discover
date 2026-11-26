/**
 * Browser transports for the listening test (web only). Self-contained: no app imports except pure logic.
 * Each connect() returns a handle; stop() turns the microphone off first, then closes everything.
 */
import { base64ToBytes, floatToPcm16, functionCallAnswerEvents, geminiAudioMessage, geminiSetupMessage, geminiToolResponse, parseGeminiMessage, pcm16ToFloat, resample, type ConnectHint } from './logic';
import { bytesToInt16 } from './elevenlabsProtocol';

export const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
/*
 * GPT-Live (checked Nov 25 against OpenAI's WebRTC guide, Microsoft's GPT-Live WebRTC guide and a GPT-Live tutorial):
 * GPT-Live issues NO ephemeral client keys, so a browser cannot connect to OpenAI by itself. The browser must send its
 * SDP offer to our own server, which calls POST https://api.openai.com/v1/live/sessions with
 * { session: { model, instructions, ... }, transport: { type: 'webrtc', sdp } } and returns transport.sdp as the answer.
 * Data channel 'oai-events'; do not send session.start; wait for session.started. Until the server relays the offer,
 * connectWebrtc refuses hint 'live' before touching the microphone.
 */
export class LiveNotWiredError extends Error {
  constructor() { super('GPT-Live needs the server to relay the connection.'); this.name = 'LiveNotWiredError'; }
}
/*
 * Gemini Live with an ephemeral token (checked Nov 25 against Google's Live API reference): token in the access_token
 * query parameter; method BidiGenerateContentConstrained. Google's reference shows v1beta only for the plain
 * BidiGenerateContent method and names no version for the constrained one; v1alpha is what Google's issue tracker
 * and forum report as working with ephemeral tokens, matching the v1alpha token mint. Still UNCONFIRMED by an official page.
 */
export const GEMINI_LIVE_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

const ICE_GRACE_MS = 1500;
const STEP_TIMEOUT_MS = 12000;

export interface TransportHandle { stop(): void }
export interface TransportHooks {
  onClosed(reason: string): void;
  /** Marty's voice as a MediaStream (webrtc). */
  onVoiceStream?(stream: MediaStream): void;
  /** An analyser on Marty's voice playback graph (gemini); called once. */
  onVoiceAnalyser?(node: AnalyserNode): void;
  /** Marty's words as they arrive. */
  onMartyText?(delta: string): void;
  /** Marty finished (or was cut off in) a reply. */
  onMartyTurnDone?(): void;
  /** Voice service word timing for a sound chunk that starts playing at `startsAt` (performance.now() ms). */
  onSpeechMarks?(marks: Array<{ kind: 'word'; value: string; startMs: number; endMs: number }>, startsAt: number): void;
  /** Marty's voice as 16 kHz mono PCM16, chunk by chunk (feeds the option B face service). */
  onVoicePcm16k?(pcm: Int16Array): void;
  /** Marty was interrupted (barge-in or Stop): drop queued sound. */
  onMartyInterrupted?(): void;
}

async function getMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(t => { t.enabled = false; t.stop(); });
}

export async function connectWebrtc(opts: { token: string; hint: ConnectHint; hooks: TransportHooks; muteOutput?: boolean }): Promise<TransportHandle> {
  const { token, hint, hooks, muteOutput } = opts;
  if (hint !== 'realtime') throw new LiveNotWiredError();
  const stream = await getMic();
  const pc = new RTCPeerConnection();
  const audio = new Audio(); audio.autoplay = true;
  if (muteOutput) audio.muted = true;
  let closed = false;
  // Optional 16 kHz tap of Marty's voice (feeds the option B face service). Only built when the hook is given.
  let tapCtx: AudioContext | null = null;
  let tapProc: ScriptProcessorNode | null = null;
  const startTap = (remote: MediaStream) => {
    if (!hooks.onVoicePcm16k || tapCtx) return;
    try {
      const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const c = new Ctx(); tapCtx = c;
      void c.resume?.().catch(() => undefined);
      const src = c.createMediaStreamSource(remote);
      const p = c.createScriptProcessor(2048, 1, 1); tapProc = p;
      p.onaudioprocess = ev => {
        if (closed) return;
        try { hooks.onVoicePcm16k?.(bytesToInt16(floatToPcm16(resample(ev.inputBuffer.getChannelData(0), c.sampleRate, 16000)))); } catch { /* preview only */ }
      };
      src.connect(p);
      const mute = c.createGain(); mute.gain.value = 0; p.connect(mute); mute.connect(c.destination);
    } catch { /* preview only */ }
  };
  const stop = () => {
    if (closed) return; closed = true;
    stopStream(stream);
    audio.pause(); audio.srcObject = null;
    if (tapProc) { tapProc.onaudioprocess = null; try { tapProc.disconnect(); } catch { /* ok */ } }
    if (tapCtx) void tapCtx.close().catch(() => undefined);
    try { dc.close(); } catch { /* already closed */ }
    try { pc.close(); } catch { /* already closed */ }
  };
  const dc = pc.createDataChannel('oai-events');
  try {
    pc.ontrack = e => { audio.srcObject = e.streams[0]; void audio.play().catch(() => undefined); if (e.streams[0]) { try { hooks.onVoiceStream?.(e.streams[0]); } catch { /* preview only */ } startTap(e.streams[0]); } };
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    dc.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        try {
          if (data.type === 'response.output_audio_transcript.delta' && typeof data.delta === 'string') hooks.onMartyText?.(data.delta);
          else if (data.type === 'input_audio_buffer.speech_started' || data.type === 'output_audio_buffer.cleared') hooks.onMartyInterrupted?.();
          else if (data.type === 'response.done' || data.type === 'output_audio_buffer.stopped') hooks.onMartyTurnDone?.();
        } catch { /* preview only */ }
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
    const response = await fetch(REALTIME_CALLS_URL, {
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
  let analyser: AnalyserNode | null = null;
  if (hooks.onVoiceAnalyser) {
    try {
      analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.3;
      hooks.onVoiceAnalyser(analyser);
    } catch { analyser = null; }
  }
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
    if (analyser) { try { src.connect(analyser); } catch { /* preview only */ } }
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
      socket.onopen = () => socket.send(geminiSetupMessage());
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
