import { useCallback, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../services/supabase';
import { VoiceSessionCoordinator, type VoicePlatformAdapter } from '../voice/voiceSessionCoordinator';
import type { VoiceMode, VoiceSessionGrant } from '../voice/sessionContract';
import { MARTY_BOSTON_CONSENT_VERSION } from '../voice/martySullivanBoston';
import { ensureMartySession, grantMartyVoiceConsent, martyAccountNote } from '../voice/martyGuest';
import { TurnController, isFatalRealtimeError, type TurnPhase, type TurnTiming } from '../voice/turnController';
import { buildScreenContextUpdateEvent, getScreenContext, screenContextKey, subscribeScreenContext, withCapturedAt } from '../voice/screenContext';

/** Keep the mic open this long after release so the last word is not clipped. */
const TALK_TAIL_MS = 250;
/** Wait for the screen to settle before telling Marty what changed. */
const CONTEXT_DEBOUNCE_MS = 500;
/** Stop waiting for more network routes this long after the first one is found. */
const ICE_GRACE_MS = 1500;
const PHASE_STATUS: Record<TurnPhase, string> = {
  idle: 'LISTENING · JUST TALK',
  talking: 'HEARING YOU',
  thinking: 'MARTY IS THINKING',
  speaking: 'MARTY IS TALKING · JUST SPEAK TO CUT IN',
};
// Only used if the server switches Marty back to hold-to-talk.
const PHASE_STATUS_PTT: Record<TurnPhase, string> = {
  idle: 'CONNECTED · HOLD TO TALK',
  talking: 'LISTENING · RELEASE TO SEND',
  thinking: 'MARTY IS THINKING',
  speaking: 'MARTY IS SPEAKING · HOLD TO CUT IN',
};
const NO_SELECT = (Platform.OS === 'web' ? { userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } : {}) as object;
const NO_MENU = (Platform.OS === 'web' ? { onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault() } : {}) as object;

export type MartyFaceState = 'idle' | 'listening' | 'thinking' | 'speaking';
/** Plain round stand-in; a later change swaps in the animated face. */
export function MartyFacePlaceholder({ state }: { state: MartyFaceState }) {
  const ring = state === 'speaking' ? '#F0F1F2' : state === 'listening' ? '#D9534F' : state === 'thinking' ? '#8DBBFF' : C.gold;
  return <View accessibilityLabel={`Marty, ${state}`} style={[s.face, { borderColor: ring }]}><Text style={s.faceLetter}>M</Text></View>;
}

type Line = { id: string; who: 'you' | 'marty' | 'system'; text: string };
const C = { bg: '#090B0F', panel: '#141820', line: '#303741', gold: '#C6A36A', text: '#F0F1F2', muted: '#A0A7B0' };
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

export function MartyPanel({ onClose, onOpenSettings, onNavigateCommand }: { onClose?: () => void; onOpenSettings: () => void; onNavigateCommand: (name: string, args: Record<string, unknown>) => Promise<string> }) {
  const { session } = useAuth();
  const [consent, setConsent] = useState(false);
  const [loadingConsent, setLoadingConsent] = useState(true);
  const [status, setStatus] = useState('OFFLINE');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState('');
  const [lastTiming, setLastTiming] = useState('');
  const [voiceMode, setVoiceMode] = useState<VoiceMode | null>(null);
  const [micOpen, setMicOpen] = useState(false);
  const [phase, setPhase] = useState<TurnPhase>('idle');
  const [live, setLive] = useState(false);
  const [showType, setShowType] = useState(false);
  const [showTalk, setShowTalk] = useState(false);
  const autoStartedRef = useRef(false);
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
  const isTalkingRef = useRef(false);
  const sessionStartedRef = useRef(false);
  const sessionStartedResolveRef = useRef<(() => void) | null>(null);
  const sessionStartedRejectRef = useRef<((error: Error) => void) | null>(null);
  const transportClosingRef = useRef(false);

  function failTransport(dc: RTCDataChannel, pc: RTCPeerConnection, message: string) {
    if (dcRef.current !== dc || pcRef.current !== pc || transportClosingRef.current) return;
    transportClosingRef.current = true;
    isTalkingRef.current = false;
    streamRef.current?.getTracks().forEach(track => { track.enabled = false; track.stop(); });
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.srcObject = null; }
    setStatus('OFFLINE'); setMicOpen(false); setLive(false); setPhase('idle');
    setError(message);
    const coordinator = coordinatorRef.current;
    coordinatorRef.current = null;
    void (async () => {
      if (coordinator) await coordinator.stop();
      else await closeTransport();
    })();
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

  function addLine(who: Line['who'], text: string) {
    if (text.trim()) setLines(old => [...old, { id: `${Date.now()}-${Math.random()}`, who, text: text.trim() }].slice(-60));
  }

  const closeTransport = useCallback(async () => {
    transportClosingRef.current = true;
    isTalkingRef.current = false;
    // Stop capture immediately, then close the WebRTC transport.
    streamRef.current?.getTracks().forEach(track => { track.enabled = false; track.stop(); });
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.srcObject = null; }
    sessionStartedRef.current = false;
    setMicOpen(false); setLive(false);
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
  }, []);

  async function runMartyNavigationTool(name: string, rawArguments: string): Promise<string> {
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawArguments || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "I couldn't understand that request.";
      args = parsed as Record<string, unknown>;
    } catch { return "I couldn't understand that request."; }
    try { return await onNavigateCommand(name, args); }
    catch { return "I couldn't complete that app action. Try the control on screen."; }
  }

  async function connectTransport(grant: VoiceSessionGrant) {
    transportClosingRef.current = false;
    sessionStartedRef.current = false;
    const stream = streamRef.current;
    if (!stream) throw new Error('Microphone permission is missing.');
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    const audio = new Audio(); audio.autoplay = true; audioRef.current = audio;
    pc.ontrack = event => { audio.srcObject = event.streams[0]; void audio.play().catch(() => undefined); };
    stream.getTracks().forEach(track => { track.enabled = false; pc.addTrack(track, stream); });
    const dc = pc.createDataChannel('oai-events'); dcRef.current = dc;
    const handsFree = grant.mode === 'hands_free';
    setVoiceMode(grant.mode);
    const turn = new TurnController({
      handsFree,
      // You started talking over Marty: silence his audio on this device at once.
      onBargeIn: () => { if (turnRef.current === turn) muteMartyNow(); },
      send: evt => { if (dc.readyState === 'open') dc.send(JSON.stringify(evt)); },
      onPhase: p => { if (turnRef.current === turn) { setPhase(p); setStatus((handsFree ? PHASE_STATUS : PHASE_STATUS_PTT)[p]); } },
      onTiming: timing => { if (turnRef.current === turn) reportTiming(timing); },
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
            const result = await runMartyNavigationTool(data.name, data.arguments || "{}");
            if (dc.readyState !== 'open' || turnRef.current !== turn) return;
            addLine('system', result);
            // Queued behind the current reply, so the follow-up never overlaps it.
            turn.sendToolResult(data.call_id, result);
          })();
        }
        if (data.type === 'response.output_audio_transcript.done' && data.transcript) {
          addLine('marty', turn.wasInterrupted(data.item_id) ? `${data.transcript} (cut off)` : data.transcript);
        }
        // Races such as cancelling a reply that already finished are harmless; only real failures end the session.
        if (data.type === 'error' && isFatalRealtimeError(data)) {
          sessionStartedRejectRef.current?.(new Error('Realtime session reported an error.'));
          sessionStartedRejectRef.current = null;
          failTransport(dc, pc, 'Marty’s voice connection encountered an error. Start a new session.');
        }
      } catch { /* Ignore non-JSON data-channel messages. */ }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise<void>((resolve, reject) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      // Full ICE gathering can take seconds on some networks. Once we have a usable route,
      // stop waiting after a short grace period so Marty connects quickly.
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
        if (opened) failTransport(dc, pc, 'Marty’s voice connection was interrupted. Start a new session.');
        else reject(new Error('Realtime data channel failed.'));
      };
      dc.onclose = () => {
        window.clearTimeout(timeout);
        if (opened) failTransport(dc, pc, 'Marty’s voice connection closed. Start a new session.');
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
      sessionStartedResolveRef.current = () => {
        window.clearTimeout(timeout);
        sessionStartedRejectRef.current = null;
        resolve();
      };
      sessionStartedRejectRef.current = error => {
        window.clearTimeout(timeout);
        sessionStartedResolveRef.current = null;
        reject(error);
      };
      if (sessionStartedRef.current) sessionStartedResolveRef.current();
    });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        failTransport(dc, pc, 'Marty’s network connection failed. Start a new session.');
      }
    };
    addLine('system', handsFree ? 'Marty is at the bar. Just talk.' : 'Marty is at the bar. Hold the button when you want to speak.');
    setLive(true);
    if (handsFree) {
      // Hands-free: the mic stays open for the whole session; Stop or closing Marty turns it off.
      stream.getAudioTracks().forEach(track => { track.enabled = true; });
      setMicOpen(true);
    }
    // The screen at start went in the session request; send only later changes.
    lastContextKeyRef.current = requestContextKeyRef.current;
    sendScreenContextNow();
  }

  function reportTiming(timing: TurnTiming) {
    // Logged so a test session can check the timing between turns.
    console.info('[marty-timing]', JSON.stringify(timing));
    if (timing.releaseToFirstAudioMs != null) setLastTiming(`Last reply started ${(timing.releaseToFirstAudioMs / 1000).toFixed(1)} s after you let go.`);
    else if (timing.interruptToSilenceMs != null) setLastTiming('Marty stopped.');
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

  // One tap: start the guest session if nobody is signed in (no sign-in screen), record the
  // voice consent this tap gives, then go straight on to the microphone and Marty.
  async function enableVoice() {
    if (busy) return;
    setBusy(true); setError(''); setStatus('GETTING MARTY READY');
    let token = '';
    try {
      const active = await ensureMartySession();
      await grantMartyVoiceConsent(active.user.id);
      token = active.access_token;
      setConsent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get Marty ready. Please try again.');
      setStatus('OFFLINE');
      return;
    } finally { setBusy(false); }
    await startSession({ accessToken: token, consentGiven: true });
  }

  async function startSession(override?: { accessToken: string; consentGiven: true }) {
    const accessToken = override?.accessToken ?? session?.access_token;
    if (!accessToken || busy || !(consent || override?.consentGiven)) return;
    if (Platform.OS !== 'web') { setError('The native iOS audio adapter still needs device validation. Use the secure web preview for this voice test.'); return; }
    setBusy(true); setError(''); setStatus('REQUESTING MICROPHONE');
    let adapter: VoicePlatformAdapter;
    adapter = {
      requestMicrophonePermission: async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
          stream.getTracks().forEach(track => { track.enabled = false; });
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
      supabaseUrl, accessToken, consentVersion: MARTY_BOSTON_CONSENT_VERSION,
      screenContext: startContext ? withCapturedAt(startContext) : null,
      platform: adapter, consentConfirmed: true,
    });
    coordinatorRef.current = coordinator;
    try {
      const result = await coordinator.start();
      if (result.voice.state === 'listening') setStatus(prev => (prev === 'REQUESTING MICROPHONE' ? 'CONNECTED' : prev));
      else {
        coordinatorRef.current = null;
        await adapter.close().catch(() => undefined);
        setStatus(result.voice.message);
        setError(result.error ?? 'Could not start the voice session.');
      }
    } catch {
      coordinatorRef.current = null;
      await adapter.close().catch(() => undefined);
      setError('Could not start Marty. Try again.');
      setStatus('OFFLINE');
    }
    finally { setBusy(false); }
  }

  function muteMartyNow() {
    // Local mute makes the cut-off instant; the server-side clear stops the rest of the reply.
    const turn = turnRef.current;
    if (audioRef.current && turn && (turn.isAudioPlaying || turn.isResponseActive)) audioRef.current.muted = true;
  }

  function beginTalk() {
    const track = streamRef.current?.getAudioTracks()[0];
    const turn = turnRef.current;
    if (!track || !turn || dcRef.current?.readyState !== 'open') return;
    // Pressed again during the release tail: keep the same turn going.
    if (tailTimerRef.current) { clearTimeout(tailTimerRef.current); tailTimerRef.current = null; return; }
    if (isTalkingRef.current) return;
    isTalkingRef.current = true;
    // Open the mic first so the first word is never lost, then cut Marty off if he is talking.
    track.enabled = true;
    muteMartyNow();
    turn.pressTalk();
  }

  function endTalk() {
    if (!isTalkingRef.current || tailTimerRef.current) return;
    tailTimerRef.current = setTimeout(() => {
      tailTimerRef.current = null;
      isTalkingRef.current = false;
      const track = streamRef.current?.getAudioTracks()[0];
      if (track) track.enabled = false;
      if (!track || dcRef.current?.readyState !== 'open') return;
      const result = turnRef.current?.releaseTalk();
      if (result === 'too_short') setLastTiming('That was a quick tap. Hold the button while you speak.');
    }, TALK_TAIL_MS);
  }

  function sendText() {
    const text = draft.trim();
    const turn = turnRef.current;
    if (!text || !turn || dcRef.current?.readyState !== 'open') return;
    muteMartyNow();
    turn.sendText(text);
    addLine('you', text); setDraft('');
  }

  async function stop() {
    isTalkingRef.current = false;
    // Close the mic first, right now, then tear the connection down.
    streamRef.current?.getTracks().forEach(track => { track.enabled = false; track.stop(); });
    setMicOpen(false); setLive(false); setPhase('idle'); setStatus('OFFLINE');
    const coordinator = coordinatorRef.current;
    coordinatorRef.current = null;
    await coordinator?.stop();
    await closeTransport();
    setStatus('OFFLINE');
  }

  function interrupt() {
    // Stops Marty mid-sentence but keeps the session open, so you can talk straight away.
    const turn = turnRef.current;
    if (!turn || dcRef.current?.readyState !== 'open') return;
    muteMartyNow();
    turn.interrupt();
  }

  useFocusEffect(useCallback(() => {
    let focused = true;
    const stopForBackground = () => {
      if (document.visibilityState !== 'hidden') return;
      void (async () => {
        const coordinator = coordinatorRef.current;
        coordinatorRef.current = null;
        await coordinator?.stop();
        if (focused) {
          setStatus('OFFLINE'); setMicOpen(false); setLive(false);
          setError('Voice session ended because the page was backgrounded. Start a new session when you return.');
        }
      })();
    };

    if (Platform.OS === 'web') document.addEventListener('visibilitychange', stopForBackground);
    return () => {
      focused = false;
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', stopForBackground);
      const coordinator = coordinatorRef.current;
      coordinatorRef.current = null;
      void (async () => {
        await coordinator?.stop();
        if (!coordinator) await closeTransport();
      })();
    };
  }, [closeTransport]));

  // Hands-free: opening Marty starts the session once consent is known to be given.
  useEffect(() => {
    if (Platform.OS !== 'web' || loadingConsent || !consent || autoStartedRef.current) return;
    if (!session?.access_token || coordinatorRef.current) return;
    autoStartedRef.current = true;
    void startSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingConsent, consent, session?.access_token]);

  const sessionOn = live || !!coordinatorRef.current;
  const face: MartyFaceState = !sessionOn ? 'idle' : phase === 'speaking' ? 'speaking' : phase === 'thinking' ? 'thinking' : micOpen ? 'listening' : 'idle';
  const pushToTalk = live && voiceMode === 'push_to_talk';
  const needsConsent = !loadingConsent && !consent;
  const canRetry = !loadingConsent && consent && !sessionOn && !busy && Platform.OS === 'web';

  return (
    <View style={s.popup}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.head}>
          <MartyFacePlaceholder state={face} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.name}>MARTY SULLIVAN</Text>
            <Text style={s.status} numberOfLines={2}>{loadingConsent ? 'CHECKING…' : busy && !sessionOn ? 'GETTING MARTY READY' : status}</Text>
          </View>
          {onClose ? <Pressable accessibilityRole="button" accessibilityLabel="Close Marty" hitSlop={8} onPress={onClose}><Ionicons name="close-circle-outline" size={24} color={C.muted} /></Pressable> : null}
        </View>
        {needsConsent ? <View style={s.block}>
          <Text style={s.body}>Tap Enable voice to say yes to talking with Marty. Your phone asks for the microphone, then Marty just talks with you, no buttons. The microphone stays on while Marty is open and turns off when you tap Stop or close him. No listening when Marty is closed. Saved memory stays off unless you turn it on separately.</Text>
          <Text style={s.notice}>{martyAccountNote(session)}</Text>
          <Pressable accessibilityRole="button" style={[s.primary, busy && s.disabled]} disabled={busy} onPress={() => void enableVoice()}><Text style={s.primaryText}>{busy ? 'GETTING READY…' : 'ENABLE VOICE'}</Text></Pressable>
          <Pressable accessibilityRole="link" onPress={onOpenSettings}><Text style={s.link}>Voice & memory settings</Text></Pressable>
        </View> : null}
        {Platform.OS !== 'web' ? <Text style={s.notice}>Voice with Marty works in the web version for now.</Text> : null}
        {live && voiceMode === 'hands_free' && micOpen ? <View style={s.micRow} accessibilityLiveRegion="polite">
          <View style={s.dot} /><Ionicons name="mic" size={16} color="#D9534F" /><Text style={s.micText}>LISTENING</Text>
        </View> : null}
        {live ? <Pressable accessibilityRole="button" accessibilityLabel="Stop Marty and turn the microphone off" style={s.stop} onPress={() => void stop()}><Ionicons name="stop-circle" size={18} color="#fff" /><Text style={s.stopText}>STOP</Text></Pressable> : null}
        {pushToTalk ? <Pressable accessibilityRole="button" style={[s.talk, NO_SELECT]} onPressIn={beginTalk} onPressOut={endTalk} {...NO_MENU}><Text selectable={false} style={[s.talkText, NO_SELECT]}>HOLD TO TALK</Text></Pressable> : null}
        {canRetry ? <Pressable accessibilityRole="button" style={s.primary} onPress={() => void startSession()}><Text style={s.primaryText}>TALK TO MARTY</Text></Pressable> : null}
        {!!lastTiming && !pushToTalk ? null : !!lastTiming ? <Text style={s.notice}>{lastTiming}</Text> : null}
        {!!error && <Text style={s.error}>{error}</Text>}
        <Pressable accessibilityRole="button" style={s.fold} onPress={() => setShowType(v => !v)}><Text style={s.foldText}>{showType ? '▾' : '▸'} Type instead</Text></Pressable>
        {showType ? <View style={s.block}>
          <TextInput value={draft} onChangeText={setDraft} onSubmitEditing={sendText} placeholder={live ? 'Say something to Marty…' : 'Works once Marty is connected'} placeholderTextColor="#707985" style={s.input} />
          <Pressable style={s.secondary} onPress={sendText}><Text style={s.secondaryText}>SEND</Text></Pressable>
        </View> : null}
        <Pressable accessibilityRole="button" style={s.fold} onPress={() => setShowTalk(v => !v)}><Text style={s.foldText}>{showTalk ? '▾' : '▸'} What we said</Text></Pressable>
        {showTalk ? <View style={s.block}>
          {lines.length === 0 ? <Text style={s.body}>Nothing yet.</Text> : lines.map(line => <View key={line.id} style={s.line}><Text style={s.lineWho}>{line.who.toUpperCase()}</Text><Text style={s.lineText}>{line.text}</Text></View>)}
        </View> : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  popup:{backgroundColor:'rgba(10,13,18,0.97)',borderWidth:1,borderColor:'rgba(198,163,106,0.7)',borderRadius:18,overflow:'hidden',maxHeight:'100%'},
  content:{padding:12,gap:10},head:{flexDirection:'row',alignItems:'center',gap:10},block:{gap:8},
  face:{width:52,height:52,borderRadius:26,borderWidth:2,backgroundColor:'#141820',alignItems:'center',justifyContent:'center'},faceLetter:{color:C.gold,fontSize:24,fontWeight:'800'},
  name:{color:C.text,fontSize:12,fontWeight:'900',letterSpacing:1.3},status:{color:C.gold,fontSize:10,fontWeight:'900',letterSpacing:1.1},
  body:{color:C.muted,fontSize:12,lineHeight:18},notice:{color:C.muted,fontSize:11,lineHeight:16},error:{color:'#E3A29A',fontSize:11,lineHeight:16},
  micRow:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:6,paddingHorizontal:10,borderRadius:10,backgroundColor:'rgba(217,83,79,0.14)',borderWidth:1,borderColor:'rgba(217,83,79,0.6)'},
  dot:{width:10,height:10,borderRadius:5,backgroundColor:'#D9534F'},micText:{color:'#F0F1F2',fontSize:11,fontWeight:'900',letterSpacing:1.3},
  stop:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'#B03A36',padding:14,borderRadius:10},stopText:{color:'#fff',fontSize:13,fontWeight:'900',letterSpacing:1.5},
  primary:{backgroundColor:C.gold,padding:13,borderRadius:9,alignItems:'center'},primaryText:{color:'#111',fontWeight:'900',fontSize:11,letterSpacing:1},disabled:{opacity:0.4},
  talk:{backgroundColor:'#D8C39A',padding:20,borderRadius:12,alignItems:'center'},talkText:{color:'#111',fontSize:14,fontWeight:'900',letterSpacing:1.5},
  secondary:{borderWidth:1,borderColor:C.gold,padding:10,borderRadius:9,alignItems:'center'},secondaryText:{color:C.gold,fontSize:10,fontWeight:'800',letterSpacing:1},
  link:{color:C.gold,fontSize:11,textDecorationLine:'underline',textAlign:'center'},fold:{paddingVertical:4},foldText:{color:C.muted,fontSize:11,fontWeight:'700'},
  input:{backgroundColor:'#0D1117',borderColor:C.line,borderWidth:1,borderRadius:10,padding:10,color:C.text,fontSize:13},
  line:{borderTopWidth:1,borderTopColor:C.line,paddingTop:8,gap:3},lineWho:{color:C.gold,fontSize:8,fontWeight:'900',letterSpacing:1},lineText:{color:C.text,fontSize:12,lineHeight:17},
});
