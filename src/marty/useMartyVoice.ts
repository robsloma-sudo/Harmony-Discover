/**
 * Marty's voice session (moved here from the old Marty panel so the scanner face can own it).
 *
 * P-20261125-0216: always-on listening. The app asks the server for mode "hands_free"; the
 * microphone then stays on for the whole session and the server hears when the guest talks
 * (talking over Marty cuts him off). If the server answers "push_to_talk" (its stop switch),
 * Marty falls back to hold-to-talk. Turning Marty off (martyPresence) stops the microphone,
 * his voice and the session at once.
 *
 * P-20261126-0102: the server picks Marty's voice. An ElevenLabs grant (Rob's "Marty" voice) plays through
 * the official ElevenLabs browser kit (src/voice/elevenlabsVoice.ts); today's OpenAI grant keeps the WebRTC
 * path below. The app sends the same request either way, so the server can switch back with no app change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../services/supabase';
import { VoiceSessionCoordinator, type VoicePlatformAdapter } from '../voice/voiceSessionCoordinator';
import { isElevenLabsGrant, type ElevenLabsVoiceGrant, type VoiceSessionGrant } from '../voice/sessionContract';
import { connectElevenLabsMarty, rmsFromElevenLabsVolume, type ElevenLabsMartyHandle } from '../voice/elevenlabsVoice';
import { MARTY_BOSTON_CONSENT_VERSION } from '../voice/martySullivanBoston';
import { isMartyLookupTool, runMartyLookup } from '../voice/martyLookups';
import { ensureMartySession, grantMartyVoiceConsent } from '../voice/martyGuest';
import { TurnController, isFatalRealtimeError, type TurnPhase, type TurnTiming } from '../voice/turnController';
import { buildScreenContextUpdateEvent, getScreenContext, screenContextKey, subscribeScreenContext, withCapturedAt } from '../voice/screenContext';
import { bindMartyOffSwitch, getMartyPresence } from './martyPresence';
import { martySessionConfig } from './martyVoiceConfig';
import { martyAgeConfirmed } from './martyAge';
import { mouthOpenFromLevel, rmsFromBytes } from './faceState';

/** Keep the mic open this long after release so the last word is not clipped (hold-to-talk fallback). */
const TALK_TAIL_MS = 250;
/** Wait for the screen to settle before telling Marty what changed. */
const CONTEXT_DEBOUNCE_MS = 500;
/** Stop waiting for more network routes this long after the first one is found. */
const ICE_GRACE_MS = 1500;

export type MartyLine = { id: string; who: 'you' | 'marty' | 'system'; text: string };
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

export interface MartyVoice {
  consent: boolean;
  loadingConsent: boolean;
  busy: boolean;
  connected: boolean;
  handsFree: boolean;
  phase: TurnPhase;
  /** 0..1 from Marty's real voice level, for the mouth. */
  mouthOpen: number;
  error: string;
  notice: string;
  lines: MartyLine[];
  enableVoice(): Promise<void>;
  startSession(): Promise<void>;
  stop(): Promise<void>;
  beginTalk(): void;
  endTalk(): void;
  sendText(text: string): void;
  interrupt(): void;
}

export function useMartyVoice({ onNavigateCommand }: { onNavigateCommand: (name: string, args: Record<string, unknown>) => Promise<string> }): MartyVoice {
  const { session } = useAuth();
  const [consent, setConsent] = useState(false);
  const [loadingConsent, setLoadingConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [phase, setPhase] = useState<TurnPhase>('idle');
  const [mouthOpen, setMouthOpen] = useState(0);
  const [lines, setLines] = useState<MartyLine[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const turnRef = useRef<TurnController | null>(null);
  const tailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastContextKeyRef = useRef<string>('');
  const requestContextKeyRef = useRef<string>('');
  const coordinatorRef = useRef<VoiceSessionCoordinator | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const isTalkingRef = useRef(false);
  /** Set while Marty talks on the ElevenLabs voice (the kit owns mic, playback and turns). */
  const elevenRef = useRef<ElevenLabsMartyHandle | null>(null);
  const elevenSpeakingRef = useRef(false);
  const sessionStartedRef = useRef(false);
  const sessionStartedResolveRef = useRef<(() => void) | null>(null);
  const sessionStartedRejectRef = useRef<((error: Error) => void) | null>(null);
  const transportClosingRef = useRef(false);
  const accessTokenRef = useRef('');
  /** Bumped by every Stop; a start that began before the latest Stop never opens the mic. */
  const stopGenRef = useRef(0);
  const startGenRef = useRef(0);
  const onNavigateRef = useRef(onNavigateCommand);
  onNavigateRef.current = onNavigateCommand;

  /** Microphone off right now (synchronous), before anything async happens. */
  const micOffNow = useCallback(() => {
    isTalkingRef.current = false;
    streamRef.current?.getTracks().forEach(track => { track.enabled = false; track.stop(); });
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.muted = true; }
    // ElevenLabs voice: the kit mutes its microphone synchronously, then ends the conversation.
    const eleven = elevenRef.current;
    elevenRef.current = null;
    elevenSpeakingRef.current = false;
    eleven?.stop();
  }, []);

  const stopLipSync = useCallback(() => {
    if (rafRef.current != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    analyserRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    setMouthOpen(0);
  }, []);

  const closeTransport = useCallback(async () => {
    transportClosingRef.current = true;
    micOffNow();
    stopLipSync();
    if (audioRef.current) { audioRef.current.srcObject = null; }
    sessionStartedRef.current = false;
    if (tailTimerRef.current) { clearTimeout(tailTimerRef.current); tailTimerRef.current = null; }
    if (contextTimerRef.current) { clearTimeout(contextTimerRef.current); contextTimerRef.current = null; }
    turnRef.current = null;
    lastContextKeyRef.current = '';
    sessionStartedRejectRef.current?.(new Error('Voice session closed before it was ready.'));
    sessionStartedRejectRef.current = null;
    sessionStartedResolveRef.current = null;
    try { dcRef.current?.close(); } catch {}
    try { pcRef.current?.close(); } catch {}
    dcRef.current = null; pcRef.current = null; streamRef.current = null; audioRef.current = null;
    setConnected(false); setHandsFree(false); setPhase('idle');
  }, [micOffNow, stopLipSync]);

  /** Ends the session now. Safe to call any time; the mic goes off before the first await. */
  const stop = useCallback(async () => {
    stopGenRef.current += 1;
    micOffNow();
    const coordinator = coordinatorRef.current;
    coordinatorRef.current = null;
    if (coordinator) await coordinator.stop();
    else await closeTransport();
  }, [closeTransport, micOffNow]);

  function failTransport(dc: RTCDataChannel, pc: RTCPeerConnection, message: string) {
    if (dcRef.current !== dc || pcRef.current !== pc || transportClosingRef.current) return;
    transportClosingRef.current = true;
    setError(message);
    void stop();
  }

  useEffect(() => {
    let alive = true;
    if (!session?.user?.id) { setLoadingConsent(false); return; }
    void supabase.from('bartender_voice_consents').select('voice_enabled,voice_consent_version,voice_withdrawn_at')
      .eq('user_id', session.user.id).maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        setConsent(Boolean(data?.voice_enabled && data.voice_consent_version === MARTY_BOSTON_CONSENT_VERSION && !data.voice_withdrawn_at));
        setLoadingConsent(false);
      });
    return () => { alive = false; };
  }, [session?.user?.id]);

  function addLine(who: MartyLine['who'], text: string) {
    if (text.trim()) setLines(old => [...old, { id: `${Date.now()}-${Math.random()}`, who, text: text.trim() }].slice(-60));
  }

  async function runMartyNavigationTool(name: string, rawArguments: string): Promise<string> {
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawArguments || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return "I couldn't understand that request.";
      args = parsed as Record<string, unknown>;
    } catch { return "I couldn't understand that request."; }
    try { return await onNavigateRef.current(name, args); }
    catch { return "I couldn't complete that app action. Try the control on screen."; }
  }

  function startLipSync(stream: MediaStream) {
    stopLipSync();
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx || typeof requestAnimationFrame !== 'function') return;
    try {
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      // Analysis only: not connected to the speakers (the audio element plays the voice).
      ctx.createMediaStreamSource(stream).connect(analyser);
      audioCtxRef.current = ctx; analyserRef.current = analyser;
      void ctx.resume?.().catch(() => undefined);
      const bytes = new Uint8Array(analyser.fftSize);
      let open = 0;
      let lastPush = 0;
      const tick = (t: number) => {
        rafRef.current = requestAnimationFrame(tick);
        const a = analyserRef.current;
        const speaking = turnRef.current?.isAudioPlaying && !audioRef.current?.muted;
        if (a && speaking) { a.getByteTimeDomainData(bytes); open = mouthOpenFromLevel(rmsFromBytes(bytes), open); }
        else open = mouthOpenFromLevel(0, open);
        // About 30 updates a second is plenty for the mouth and keeps re-renders cheap.
        if (t - lastPush >= 33) { lastPush = t; setMouthOpen(prev => (prev === open ? prev : open)); }
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch { /* No lip sync; Marty still talks. */ }
  }

  function muteMartyNow() {
    // Local mute makes the cut-off instant; the server stops the rest of the reply.
    const turn = turnRef.current;
    if (audioRef.current && turn && (turn.isAudioPlaying || turn.isResponseActive)) audioRef.current.muted = true;
  }

  /** Mouth sync for the ElevenLabs voice: the kit reports how loud Marty is right now. */
  function startElevenLabsLipSync(handle: ElevenLabsMartyHandle) {
    stopLipSync();
    if (typeof requestAnimationFrame !== 'function') return;
    let open = 0;
    let lastPush = 0;
    const tick = (t: number) => {
      rafRef.current = requestAnimationFrame(tick);
      const live = elevenRef.current === handle && elevenSpeakingRef.current;
      open = mouthOpenFromLevel(live ? rmsFromElevenLabsVolume(handle.outputVolume()) : 0, open);
      if (t - lastPush >= 33) { lastPush = t; setMouthOpen(prev => (prev === open ? prev : open)); }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  async function connectElevenLabsTransport(grant: ElevenLabsVoiceGrant) {
    // The kit opens its own microphone; close the permission check's one so only one mic is ever open.
    streamRef.current?.getTracks().forEach(track => { track.enabled = false; track.stop(); });
    streamRef.current = null;
    elevenSpeakingRef.current = false;
    let handle: ElevenLabsMartyHandle | null = null;
    const isMine = () => handle !== null && elevenRef.current === handle;
    const alwaysOn = grant.mode === 'hands_free';
    // The agent's tools run here exactly as on the OpenAI voice: look-ups on the server, navigation in the app.
    const clientTools: Record<string, (parameters: unknown) => Promise<string>> = {};
    for (const name of grant.clientTools) {
      clientTools[name] = async (parameters) => {
        const rawArguments = JSON.stringify(parameters && typeof parameters === 'object' ? parameters : {});
        if (isMartyLookupTool(name)) return runMartyLookup({ supabaseUrl, accessToken: accessTokenRef.current, tool: name, rawArguments });
        const result = await runMartyNavigationTool(name, rawArguments);
        if (isMine()) addLine('system', result);
        return result;
      };
    }
    handle = await connectElevenLabsMarty({
      conversationToken: grant.conversationToken,
      dynamicVariables: grant.dynamicVariables,
      clientTools,
      startMuted: !alwaysOn,
      hooks: {
        onMode: mode => {
          if (!isMine()) return;
          elevenSpeakingRef.current = mode === 'speaking';
          setPhase(mode === 'speaking' ? 'speaking' : 'idle');
        },
        onLine: (who, text) => { if (isMine()) addLine(who, text); },
        onClosed: reason => {
          if (!isMine() || transportClosingRef.current) return;
          transportClosingRef.current = true;
          setError(reason === 'failed'
            ? 'Marty’s voice connection hit an error. Tap Talk to Marty to start again.'
            : 'Marty’s voice connection closed. Tap Talk to Marty to start again.');
          void stop();
        },
      },
    });
    elevenRef.current = handle;
    // Last check: if Marty was switched off or stopped while connecting, end it now (mic included).
    if (!getMartyPresence().enabled) throw new Error('Marty was turned off.');
    if (startGenRef.current !== stopGenRef.current) throw new Error('Marty was stopped.');
    startElevenLabsLipSync(handle);
    setHandsFree(alwaysOn);
    setConnected(true);
    if (alwaysOn) {
      setNotice('');
      addLine('system', 'Marty is listening. Just talk. Turn him off any time with the switch.');
    } else {
      setNotice('Always-on listening is switched off on the server right now, so Marty is on hold-to-talk.');
      addLine('system', 'Marty is at the bar. Hold the button when you want to speak.');
    }
  }

  async function connectTransport(grant: VoiceSessionGrant) {
    transportClosingRef.current = false;
    sessionStartedRef.current = false;
    if (isElevenLabsGrant(grant)) { await connectElevenLabsTransport(grant); return; }
    const stream = streamRef.current;
    if (!stream) throw new Error('Microphone permission is missing.');
    const alwaysOn = grant.mode === 'hands_free';
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    const audio = new Audio(); audio.autoplay = true; audioRef.current = audio;
    pc.ontrack = event => { audio.srcObject = event.streams[0]; void audio.play().catch(() => undefined); startLipSync(event.streams[0]); };
    stream.getTracks().forEach(track => { track.enabled = false; pc.addTrack(track, stream); });
    const dc = pc.createDataChannel('oai-events'); dcRef.current = dc;
    const turn = new TurnController({
      send: evt => { if (dc.readyState === 'open') dc.send(JSON.stringify(evt)); },
      onPhase: p => { if (turnRef.current === turn) setPhase(p); },
      onTiming: timing => { if (turnRef.current === turn) reportTiming(timing); },
      handsFree: alwaysOn,
      onBargeIn: () => { if (audioRef.current) audioRef.current.muted = true; },
    });
    turnRef.current = turn;
    dc.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        turn.handleServerEvent(data);
        // Unmute as soon as a new reply starts playing (it is muted on barge-in/interrupt).
        if (data.type === 'output_audio_buffer.started' && audioRef.current) audioRef.current.muted = false;
        if (data.type === 'session.created') {
          sessionStartedRef.current = true;
          sessionStartedRejectRef.current = null;
          sessionStartedResolveRef.current?.();
          sessionStartedResolveRef.current = null;
        }
        if (data.type === 'conversation.item.input_audio_transcription.completed' && data.transcript) addLine('you', data.transcript);
        if (data.type === 'response.function_call_arguments.done' && typeof data.name === 'string' && typeof data.call_id === 'string') {
          void (async () => {
            if (isMartyLookupTool(data.name)) {
              // Look-ups run on the server; the answer goes back to Marty unchanged and is not shown as a line.
              const output = await runMartyLookup({ supabaseUrl, accessToken: accessTokenRef.current, tool: data.name, rawArguments: typeof data.arguments === 'string' ? data.arguments : '{}' });
              if (dc.readyState !== 'open' || turnRef.current !== turn) return;
              turn.sendToolResult(data.call_id, output);
              return;
            }
            const result = await runMartyNavigationTool(data.name, data.arguments || '{}');
            if (dc.readyState !== 'open' || turnRef.current !== turn) return;
            addLine('system', result);
            turn.sendToolResult(data.call_id, result);
          })();
        }
        if (data.type === 'response.output_audio_transcript.done' && data.transcript) {
          addLine('marty', turn.wasInterrupted(data.item_id) ? `${data.transcript} (cut off)` : data.transcript);
        }
        if (data.type === 'error' && isFatalRealtimeError(data)) {
          sessionStartedRejectRef.current?.(new Error('Realtime session reported an error.'));
          sessionStartedRejectRef.current = null;
          failTransport(dc, pc, 'Marty’s voice connection hit an error. Tap Talk to Marty to start again.');
        }
      } catch { /* Ignore non-JSON data-channel messages. */ }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise<void>((resolve, reject) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      let candidates = 0;
      let done = false;
      const finish = () => { if (done) return; done = true; window.clearTimeout(timeout); window.clearTimeout(grace); resolve(); };
      const timeout = window.setTimeout(() => { if (done) return; done = true; window.clearTimeout(grace); if (candidates > 0) resolve(); else reject(new Error('Network setup timed out.')); }, 12000);
      const grace = window.setTimeout(() => { if (candidates > 0) finish(); }, ICE_GRACE_MS);
      pc.onicecandidate = event => {
        if (!event.candidate) return;
        candidates += 1;
        if (/ typ (srflx|relay) /.test(` ${event.candidate.candidate} `)) finish();
      };
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') finish(); };
    });
    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${grant.ephemeralToken}`, 'Content-Type': 'application/sdp' },
      body: pc.localDescription?.sdp,
    });
    if (!response.ok) throw new Error('Realtime connection could not be established.');
    await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    await new Promise<void>((resolve, reject) => {
      let opened = dc.readyState === 'open';
      const timeout = window.setTimeout(() => reject(new Error('Realtime data channel timed out.')), 12000);
      const ready = () => { opened = true; window.clearTimeout(timeout); resolve(); };
      dc.onopen = ready;
      dc.onerror = () => {
        window.clearTimeout(timeout);
        if (opened) failTransport(dc, pc, 'Marty’s voice connection was interrupted. Tap Talk to Marty to start again.');
        else reject(new Error('Realtime data channel failed.'));
      };
      dc.onclose = () => {
        window.clearTimeout(timeout);
        if (opened) failTransport(dc, pc, 'Marty’s voice connection closed. Tap Talk to Marty to start again.');
        else reject(new Error('Realtime data channel closed before it was ready.'));
      };
      if (dc.readyState === 'open') ready();
      else if (dc.readyState === 'closed') { window.clearTimeout(timeout); reject(new Error('Realtime data channel closed before it was ready.')); }
    });
    await new Promise<void>((resolve, reject) => {
      if (sessionStartedRef.current) { resolve(); return; }
      const timeout = window.setTimeout(() => {
        sessionStartedResolveRef.current = null;
        sessionStartedRejectRef.current = null;
        reject(new Error('Realtime session did not become ready.'));
      }, 12000);
      sessionStartedResolveRef.current = () => { window.clearTimeout(timeout); sessionStartedRejectRef.current = null; resolve(); };
      sessionStartedRejectRef.current = err => { window.clearTimeout(timeout); sessionStartedResolveRef.current = null; reject(err); };
      if (sessionStartedRef.current) sessionStartedResolveRef.current();
    });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') failTransport(dc, pc, 'Marty’s network connection failed. Tap Talk to Marty to start again.');
    };
    // Last check: if Marty was switched off while connecting, never open the microphone.
    if (!getMartyPresence().enabled) throw new Error('Marty was turned off.');
    if (startGenRef.current !== stopGenRef.current) throw new Error('Marty was stopped.');
    setHandsFree(alwaysOn);
    setConnected(true);
    if (alwaysOn) {
      // Always-on: the microphone stays on for the whole session (the listening ring on his face shows it).
      stream.getAudioTracks().forEach(track => { track.enabled = true; });
      setNotice('');
      addLine('system', 'Marty is listening. Just talk. Turn him off any time with the switch.');
    } else {
      setNotice('Always-on listening is switched off on the server right now, so Marty is on hold-to-talk.');
      addLine('system', 'Marty is at the bar. Hold the button when you want to speak.');
    }
    lastContextKeyRef.current = requestContextKeyRef.current;
    sendScreenContextNow();
  }

  function reportTiming(timing: TurnTiming) {
    console.info('[marty-timing]', JSON.stringify(timing));
  }

  function sendScreenContextNow() {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open' || !turnRef.current) return;
    const ctx = getScreenContext();
    const key = screenContextKey(ctx);
    if (!ctx || key === lastContextKeyRef.current) return;
    const event = buildScreenContextUpdateEvent(withCapturedAt(ctx));
    if (!event) return;
    lastContextKeyRef.current = key;
    dc.send(JSON.stringify(event));
  }

  useEffect(() => subscribeScreenContext(() => {
    if (contextTimerRef.current) clearTimeout(contextTimerRef.current);
    contextTimerRef.current = setTimeout(() => { contextTimerRef.current = null; sendScreenContextNow(); }, CONTEXT_DEBOUNCE_MS);
  }), []);

  async function startSession(override?: { accessToken: string; consentGiven: true }) {
    const accessToken = override?.accessToken ?? session?.access_token;
    if (!accessToken || busy || coordinatorRef.current || !(consent || override?.consentGiven)) return;
    if (!getMartyPresence().enabled) return;
    // 21+ check (P-20261125-2244): no voice session at all until this device answered Yes.
    if (!martyAgeConfirmed()) return;
    if (Platform.OS !== 'web') { setError('Marty’s voice in the phone app still needs testing on a real iPhone. Use the web preview for now.'); return; }
    accessTokenRef.current = accessToken;
    setBusy(true); setError(''); setNotice('');
    const gen = stopGenRef.current;
    startGenRef.current = gen;
    const adapter: VoicePlatformAdapter = {
      requestMicrophonePermission: async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
          stream.getTracks().forEach(track => { track.enabled = false; });
          // Stop was pressed while the browser was asking: close the mic straight away.
          if (gen !== stopGenRef.current || !getMartyPresence().enabled) { stream.getTracks().forEach(track => track.stop()); return 'denied'; }
          streamRef.current = stream;
          return 'granted';
        } catch { return 'denied'; }
      },
      connect: connectTransport,
      close: closeTransport,
    };
    const startContext = getScreenContext();
    requestContextKeyRef.current = screenContextKey(startContext);
    const coordinator = new VoiceSessionCoordinator({
      ...martySessionConfig({ supabaseUrl, accessToken, screenContext: startContext ? withCapturedAt(startContext) : null }),
      platform: adapter, consentConfirmed: true,
    });
    coordinatorRef.current = coordinator;
    try {
      const result = await coordinator.start();
      if (result.voice.state !== 'listening' && coordinatorRef.current === coordinator) {
        coordinatorRef.current = null;
        await adapter.close().catch(() => undefined);
        if (gen === stopGenRef.current) setError(result.error ?? 'Could not start Marty’s voice.');
      }
    } catch {
      if (coordinatorRef.current === coordinator) coordinatorRef.current = null;
      await adapter.close().catch(() => undefined);
      if (gen === stopGenRef.current) setError('Could not start Marty. Try again.');
    } finally { setBusy(false); }
  }

  // One tap: guest session if needed (no sign-in), record voice consent, then microphone and Marty.
  async function enableVoice() {
    if (busy || !martyAgeConfirmed()) return;
    setBusy(true); setError('');
    const gen = stopGenRef.current;
    let token = '';
    try {
      const active = await ensureMartySession();
      await grantMartyVoiceConsent(active.user.id);
      token = active.access_token;
      setConsent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get Marty ready. Please try again.');
      return;
    } finally { setBusy(false); }
    // Stop pressed while getting ready: do not go on to the microphone.
    if (gen !== stopGenRef.current) return;
    await startSession({ accessToken: token, consentGiven: true });
  }

  // Hold-to-talk fallback (only when the server granted push_to_talk).
  function beginTalk() {
    const eleven = elevenRef.current;
    if (eleven) {
      if (tailTimerRef.current) { clearTimeout(tailTimerRef.current); tailTimerRef.current = null; return; }
      if (isTalkingRef.current) return;
      isTalkingRef.current = true;
      eleven.setMicMuted(false);
      return;
    }
    const track = streamRef.current?.getAudioTracks()[0];
    const turn = turnRef.current;
    if (!track || !turn || turn.isHandsFree || dcRef.current?.readyState !== 'open') return;
    if (tailTimerRef.current) { clearTimeout(tailTimerRef.current); tailTimerRef.current = null; return; }
    if (isTalkingRef.current) return;
    isTalkingRef.current = true;
    track.enabled = true;
    muteMartyNow();
    turn.pressTalk();
  }

  function endTalk() {
    if (!isTalkingRef.current || tailTimerRef.current) return;
    tailTimerRef.current = setTimeout(() => {
      tailTimerRef.current = null;
      isTalkingRef.current = false;
      if (elevenRef.current) { elevenRef.current.setMicMuted(true); return; }
      const track = streamRef.current?.getAudioTracks()[0];
      if (track) track.enabled = false;
      if (!track || dcRef.current?.readyState !== 'open') return;
      turnRef.current?.releaseTalk();
    }, TALK_TAIL_MS);
  }

  function sendText(text: string) {
    const t = text.trim();
    // ElevenLabs voice: the kit takes typed text directly (its own turn-taking handles the rest).
    if (t && elevenRef.current) { if (elevenRef.current.sendText(t)) addLine('you', t); return; }
    const turn = turnRef.current;
    if (!t || !turn || dcRef.current?.readyState !== 'open') return;
    muteMartyNow();
    turn.sendText(t);
    addLine('you', t);
  }

  function interrupt() {
    const turn = turnRef.current;
    if (!turn || dcRef.current?.readyState !== 'open') return;
    muteMartyNow();
    turn.interrupt();
  }

  // The one off switch: the moment Marty is turned off, microphone and voice stop.
  useEffect(() => bindMartyOffSwitch(() => { micOffNow(); void stop(); }), [micOffNow, stop]);

  // Leaving the page or hiding the tab ends the session: never listen in the background.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onHide = () => {
      if (document.visibilityState !== 'hidden' || !coordinatorRef.current) return;
      setNotice('Marty stopped listening because the page went into the background.');
      void stop();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [stop]);

  useEffect(() => () => { void stop(); }, [stop]);

  return {
    consent, loadingConsent, busy, connected, handsFree, phase, mouthOpen, error, notice, lines,
    enableVoice, startSession: () => startSession(), stop, beginTalk, endTalk, sendText, interrupt,
  };
}
