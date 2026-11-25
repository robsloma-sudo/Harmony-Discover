import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../services/supabase';
import { VoiceSessionCoordinator, type VoicePlatformAdapter } from '../voice/voiceSessionCoordinator';
import type { VoiceSessionGrant } from '../voice/sessionContract';
import { MARTY_BOSTON_CONSENT_VERSION } from '../voice/martySullivanBoston';
import { TurnController, isFatalRealtimeError, type TurnPhase, type TurnTiming } from '../voice/turnController';
import { buildScreenContextUpdateEvent, getScreenContext, screenContextKey, subscribeScreenContext, withCapturedAt } from '../voice/screenContext';

/** Keep the mic open this long after release so the last word is not clipped. */
const TALK_TAIL_MS = 250;
/** Wait for the screen to settle before telling Marty what changed. */
const CONTEXT_DEBOUNCE_MS = 500;
/** Stop waiting for more network routes this long after the first one is found. */
const ICE_GRACE_MS = 1500;
const PHASE_STATUS: Record<TurnPhase, string> = {
  idle: 'CONNECTED · HOLD TO TALK',
  talking: 'LISTENING · RELEASE TO SEND',
  thinking: 'MARTY IS THINKING',
  speaking: 'MARTY IS SPEAKING · HOLD TO CUT IN',
};

type Line = { id: string; who: 'you' | 'marty' | 'system'; text: string };
const C = { bg: '#090B0F', panel: '#141820', line: '#303741', gold: '#C6A36A', text: '#F0F1F2', muted: '#A0A7B0' };
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

export function MartyPanel({ onOpenSettings, onNavigateCommand }: { onOpenSettings: () => void; onNavigateCommand: (name: string, args: Record<string, unknown>) => Promise<string> }) {
  const { session } = useAuth();
  const [consent, setConsent] = useState(false);
  const [loadingConsent, setLoadingConsent] = useState(true);
  const [status, setStatus] = useState('OFFLINE');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState('');
  const [lastTiming, setLastTiming] = useState('');
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
    setStatus('OFFLINE');
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
    const turn = new TurnController({
      send: evt => { if (dc.readyState === 'open') dc.send(JSON.stringify(evt)); },
      onPhase: phase => { if (turnRef.current === turn) setStatus(PHASE_STATUS[phase]); },
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
    addLine('system', 'Marty is at the bar. Hold the button when you want to speak.');
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

  async function startSession() {
    if (!session?.access_token || busy || !consent) return;
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
      supabaseUrl, accessToken: session.access_token, consentVersion: MARTY_BOSTON_CONSENT_VERSION,
      screenContext: startContext ? withCapturedAt(startContext) : null,
      platform: adapter, consentConfirmed: true,
    });
    coordinatorRef.current = coordinator;
    try {
      const result = await coordinator.start();
      if (result.voice.state === 'listening') setStatus('CONNECTED · HOLD TO TALK');
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
    await coordinatorRef.current?.stop();
    coordinatorRef.current = null;
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
          setStatus('OFFLINE');
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

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      
      <Text style={s.kicker}>HARMONY DISCOVER · MARTY SULLIVAN</Text>
      <Text style={s.title}>Pull up a stool.</Text>
      <Text style={s.body}>Boston / South Boston profile v1.0.0. Older neighborhood bartender. Dry wit. Serious beverage knowledge. No cartoon accent.</Text>
      {loadingConsent ? <Text style={s.status}>Checking your consent…</Text> : !consent ? <View style={s.card}>
        <Text style={s.heading}>Voice consent is off.</Text>
        <Text style={s.body}>Marty does not request microphone access until you explicitly enable voice here.</Text>
        <Pressable style={s.primary} onPress={onOpenSettings}><Text style={s.primaryText}>REVIEW VOICE CONSENT</Text></Pressable>
      </View> : null}
      {Platform.OS !== 'web' ? <Text style={s.notice}>Native iOS voice transport is not validated yet. Use the secure web preview for this audition.</Text> : null}
      <View style={s.card}>
        <Text style={s.status}>{status}</Text>
        <Text style={s.body}>Push-to-talk only. The microphone is off between turns. Hold to talk (this also cuts Marty off), release to send. Marty can see what is on screen: the scanned menu, bottle or Journey.</Text>
        {!coordinatorRef.current ? <Pressable disabled={!consent || busy || Platform.OS !== 'web'} style={[s.primary, (!consent || busy || Platform.OS !== 'web') && s.disabled]} onPress={() => void startSession()}><Text style={s.primaryText}>{busy ? 'CONNECTING…' : 'START VOICE SESSION'}</Text></Pressable> : <>
          <Pressable style={s.talk} onPressIn={beginTalk} onPressOut={endTalk}><Text style={s.talkText}>HOLD TO TALK</Text></Pressable>
          <Pressable style={s.secondary} onPress={interrupt}><Text style={s.secondaryText}>INTERRUPT MARTY</Text></Pressable>
          <Pressable style={s.secondary} onPress={() => void stop()}><Text style={s.secondaryText}>END SESSION</Text></Pressable>
        </>}
        {!!lastTiming && <Text style={s.notice}>{lastTiming}</Text>}
        {!!error && <Text style={s.error}>{error}</Text>}
      </View>
      <View style={s.card}>
        <Text style={s.heading}>Typed fallback</Text>
        <Text style={s.body}>Text works once the voice session is connected.</Text>
        <TextInput value={draft} onChangeText={setDraft} placeholder="Say something to Marty…" placeholderTextColor="#707985" style={s.input} />
        <Pressable style={s.secondary} onPress={sendText}><Text style={s.secondaryText}>SEND TEXT</Text></Pressable>
      </View>
      <View style={s.card}>
        <Text style={s.heading}>Conversation</Text>
        {lines.length === 0 ? <Text style={s.body}>No conversation yet.</Text> : lines.map(line => <View key={line.id} style={s.line}><Text style={s.lineWho}>{line.who.toUpperCase()}</Text><Text style={s.lineText}>{line.text}</Text></View>)}
      </View>
      <Text style={s.footer}>VOICE AND MEMORY ARE SEPARATE CONSENTS · NO BACKGROUND LISTENING · SESSION TRANSCRIPT IS NOT SAVED AS MEMORY</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root:{flex:1,backgroundColor:'transparent'},content:{padding:4,paddingTop:4,paddingBottom:16,gap:12},back:{color:C.gold,fontSize:11,fontWeight:'800',letterSpacing:1.3},
  kicker:{color:C.gold,fontSize:9,letterSpacing:1.8,fontWeight:'800',marginTop:12},title:{color:C.text,fontSize:34,fontWeight:'800'},body:{color:C.muted,fontSize:12,lineHeight:19},
  card:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:16,padding:16,gap:12},heading:{color:C.text,fontSize:16,fontWeight:'800'},status:{color:C.gold,fontSize:10,fontWeight:'900',letterSpacing:1.1},
  primary:{backgroundColor:C.gold,padding:14,borderRadius:9,alignItems:'center'},primaryText:{color:'#111',fontWeight:'900',fontSize:11,letterSpacing:1},disabled:{opacity:0.4},
  talk:{backgroundColor:'#D8C39A',padding:22,borderRadius:12,alignItems:'center'},talkText:{color:'#111',fontSize:14,fontWeight:'900',letterSpacing:1.5},
  secondary:{borderWidth:1,borderColor:C.gold,padding:12,borderRadius:9,alignItems:'center'},secondaryText:{color:C.gold,fontSize:10,fontWeight:'800',letterSpacing:1},
  input:{backgroundColor:'#0D1117',borderColor:C.line,borderWidth:1,borderRadius:10,padding:12,color:C.text,fontSize:13},error:{color:'#E3A29A',fontSize:11,lineHeight:16},notice:{color:C.muted,fontSize:11,lineHeight:17},
  line:{borderTopWidth:1,borderTopColor:C.line,paddingTop:10,gap:4},lineWho:{color:C.gold,fontSize:8,fontWeight:'900',letterSpacing:1},lineText:{color:C.text,fontSize:13,lineHeight:19},footer:{color:'#707985',fontSize:8,textAlign:'center',letterSpacing:1.1},
});
