import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useAuth } from '../src/auth/AuthContext';
import { supabase } from '../src/services/supabase';
import { VoiceSessionCoordinator, type VoicePlatformAdapter } from '../src/voice/voiceSessionCoordinator';
import type { VoiceSessionGrant } from '../src/voice/sessionContract';
import { MARTY_BOSTON_CONSENT_VERSION } from '../src/voice/martySullivanBoston';

type Line = { id: string; who: 'you' | 'marty' | 'system'; text: string };
const C = { bg: '#090B0F', panel: '#141820', line: '#303741', gold: '#C6A36A', text: '#F0F1F2', muted: '#A0A7B0' };
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

export default function BartenderScreen() {
  const { session } = useAuth();
  const [consent, setConsent] = useState(false);
  const [loadingConsent, setLoadingConsent] = useState(true);
  const [status, setStatus] = useState('OFFLINE');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState('');
  const coordinatorRef = useRef<VoiceSessionCoordinator | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isTalkingRef = useRef(false);
  const sessionStartedRef = useRef(false);
  const sessionStartedResolveRef = useRef<(() => void) | null>(null);
  const sessionStartedRejectRef = useRef<((error: Error) => void) | null>(null);
  const sessionClosedResolveRef = useRef<(() => void) | null>(null);

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
    isTalkingRef.current = false;
    sessionStartedRejectRef.current?.(new Error('Voice session closed before it was ready.'));
    sessionStartedRejectRef.current = null;
    sessionStartedResolveRef.current = null;

    const channel = dcRef.current;
    if (channel?.readyState === 'open' && sessionStartedRef.current) {
      await new Promise<void>(resolve => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          window.clearTimeout(timeout);
          sessionClosedResolveRef.current = null;
          resolve();
        };
        const timeout = window.setTimeout(finish, 2500);
        sessionClosedResolveRef.current = finish;
        try { channel.send(JSON.stringify({ type: 'session.close' })); }
        catch { finish(); }
      });
    }

    sessionStartedRef.current = false;
    try { channel?.close(); } catch {}
    try { pcRef.current?.close(); } catch {}
    streamRef.current?.getTracks().forEach(track => track.stop());
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.srcObject = null; }
    dcRef.current = null; pcRef.current = null; streamRef.current = null; audioRef.current = null;
  }, []);

  async function connectTransport(grant: VoiceSessionGrant) {
    sessionStartedRef.current = false;
    const stream = streamRef.current;
    if (!stream) throw new Error('Microphone permission is missing.');
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    const audio = new Audio(); audio.autoplay = true; audioRef.current = audio;
    pc.ontrack = event => { audio.srcObject = event.streams[0]; void audio.play().catch(() => undefined); };
    stream.getTracks().forEach(track => { track.enabled = false; pc.addTrack(track, stream); });
    const dc = pc.createDataChannel('oai-events'); dcRef.current = dc;
    dc.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'session.started') {
          sessionStartedRef.current = true;
          sessionStartedRejectRef.current = null;
          sessionStartedResolveRef.current?.();
          sessionStartedResolveRef.current = null;
        }
        if (data.type === 'session.closed') {
          sessionStartedRef.current = false;
          sessionClosedResolveRef.current?.();
        }
        if (data.type === 'conversation.item.input_audio_transcription.completed' && data.transcript) addLine('you', data.transcript);
        if (data.type === 'response.output_audio_transcript.done' && data.transcript) addLine('marty', data.transcript);
        if (data.type === 'response.output_audio_transcript.delta' && data.delta) setStatus('MARTY IS SPEAKING');
        if (data.type === 'response.done') setStatus('CONNECTED · HOLD TO TALK');
        if (data.type === 'error') {
          sessionStartedRejectRef.current?.(new Error('Realtime session reported an error.'));
          sessionStartedRejectRef.current = null;
          setError('Realtime session reported an error.');
        }
      } catch { /* Ignore non-JSON data-channel messages. */ }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise<void>((resolve, reject) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const timeout = window.setTimeout(() => reject(new Error('Network setup timed out.')), 12000);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') { window.clearTimeout(timeout); resolve(); }
      };
    });
    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${grant.ephemeralToken}`, 'Content-Type': 'application/sdp' },
      body: pc.localDescription?.sdp,
    });
    if (!response.ok) throw new Error('Realtime connection could not be established.');
    await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Realtime data channel timed out.')), 12000);
      const ready = () => { window.clearTimeout(timeout); resolve(); };
      dc.onopen = ready;
      dc.onerror = () => { window.clearTimeout(timeout); reject(new Error('Realtime data channel failed.')); };
      dc.onclose = () => { window.clearTimeout(timeout); reject(new Error('Realtime data channel closed before it was ready.')); };
      if (dc.readyState === 'open') ready();
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
    addLine('system', 'Marty is at the bar. Hold the button when you want to speak.');
  }

  async function startSession() {
    if (!session?.access_token || busy || !consent) return;
    if (Platform.OS !== 'web') { setError('The native iOS audio adapter still needs device validation. Use the secure web preview for this voice test.'); return; }
    setBusy(true); setError(''); setStatus('REQUESTING MICROPHONE');
    let adapter: VoicePlatformAdapter;
    adapter = {
      requestMicrophonePermission: async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => { track.enabled = false; });
          streamRef.current = stream;
          return 'granted';
        } catch { return 'denied'; }
      },
      connect: connectTransport,
      close: closeTransport,
    };
    const coordinator = new VoiceSessionCoordinator({
      supabaseUrl, accessToken: session.access_token, consentVersion: MARTY_BOSTON_CONSENT_VERSION,
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

  function beginTalk() {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track || dcRef.current?.readyState !== 'open' || isTalkingRef.current) return;
    isTalkingRef.current = true;
    track.enabled = true; setStatus('LISTENING · RELEASE TO SEND');
  }

  function endTalk() {
    if (!isTalkingRef.current) return;
    isTalkingRef.current = false;
    const track = streamRef.current?.getAudioTracks()[0];
    if (track) track.enabled = false;
    if (!track || dcRef.current?.readyState !== 'open') return;
    dcRef.current.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    dcRef.current.send(JSON.stringify({ type: 'response.create', response: { output_modalities: ['audio'] } }));
    setStatus('MARTY IS THINKING');
  }

  function sendText() {
    const text = draft.trim();
    if (!text || dcRef.current?.readyState !== 'open') return;
    dcRef.current.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }));
    dcRef.current.send(JSON.stringify({ type: 'response.create', response: { output_modalities: ['audio'] } }));
    addLine('you', text); setDraft(''); setStatus('MARTY IS THINKING');
  }

  async function stop() {
    isTalkingRef.current = false;
    await coordinatorRef.current?.stop();
    coordinatorRef.current = null;
    setStatus('OFFLINE');
  }

  async function interrupt() {
    isTalkingRef.current = false;
    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'response.cancel' }));
      dcRef.current.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
    }
    await coordinatorRef.current?.interrupt();
    coordinatorRef.current = null;
    setStatus('INTERRUPTED');
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
      <Pressable onPress={() => router.back()}><Text style={s.back}>‹ BACK TO DISCOVER</Text></Pressable>
      <Text style={s.kicker}>HARMONY DISCOVER · MARTY SULLIVAN</Text>
      <Text style={s.title}>Pull up a stool.</Text>
      <Text style={s.body}>Boston / South Boston profile v1.0.0. Older neighborhood bartender. Dry wit. Serious beverage knowledge. No cartoon accent.</Text>
      {loadingConsent ? <Text style={s.status}>Checking your consent…</Text> : !consent ? <View style={s.card}>
        <Text style={s.heading}>Voice consent is off.</Text>
        <Text style={s.body}>Marty does not request microphone access until you explicitly enable voice here.</Text>
        <Pressable style={s.primary} onPress={() => router.push('/bartender-settings')}><Text style={s.primaryText}>REVIEW VOICE CONSENT</Text></Pressable>
      </View> : null}
      {Platform.OS !== 'web' ? <Text style={s.notice}>Native iOS voice transport is not validated yet. Use the secure web preview for this audition.</Text> : null}
      <View style={s.card}>
        <Text style={s.status}>{status}</Text>
        <Text style={s.body}>Push-to-talk only. The microphone is disabled between turns. Release the button to commit your speech and ask Marty to respond.</Text>
        {!coordinatorRef.current ? <Pressable disabled={!consent || busy || Platform.OS !== 'web'} style={[s.primary, (!consent || busy || Platform.OS !== 'web') && s.disabled]} onPress={() => void startSession()}><Text style={s.primaryText}>{busy ? 'CONNECTING…' : 'START VOICE SESSION'}</Text></Pressable> : <>
          <Pressable style={s.talk} onPressIn={beginTalk} onPressOut={endTalk}><Text style={s.talkText}>HOLD TO TALK</Text></Pressable>
          <Pressable style={s.secondary} onPress={() => void interrupt()}><Text style={s.secondaryText}>INTERRUPT MARTY</Text></Pressable>
          <Pressable style={s.secondary} onPress={() => void stop()}><Text style={s.secondaryText}>END SESSION</Text></Pressable>
        </>}
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
  root:{flex:1,backgroundColor:C.bg},content:{padding:20,paddingTop:54,paddingBottom:50,gap:15},back:{color:C.gold,fontSize:11,fontWeight:'800',letterSpacing:1.3},
  kicker:{color:C.gold,fontSize:9,letterSpacing:1.8,fontWeight:'800',marginTop:12},title:{color:C.text,fontSize:34,fontWeight:'800'},body:{color:C.muted,fontSize:12,lineHeight:19},
  card:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:16,padding:16,gap:12},heading:{color:C.text,fontSize:16,fontWeight:'800'},status:{color:C.gold,fontSize:10,fontWeight:'900',letterSpacing:1.1},
  primary:{backgroundColor:C.gold,padding:14,borderRadius:9,alignItems:'center'},primaryText:{color:'#111',fontWeight:'900',fontSize:11,letterSpacing:1},disabled:{opacity:0.4},
  talk:{backgroundColor:'#D8C39A',padding:22,borderRadius:12,alignItems:'center'},talkText:{color:'#111',fontSize:14,fontWeight:'900',letterSpacing:1.5},
  secondary:{borderWidth:1,borderColor:C.gold,padding:12,borderRadius:9,alignItems:'center'},secondaryText:{color:C.gold,fontSize:10,fontWeight:'800',letterSpacing:1},
  input:{backgroundColor:'#0D1117',borderColor:C.line,borderWidth:1,borderRadius:10,padding:12,color:C.text,fontSize:13},error:{color:'#E3A29A',fontSize:11,lineHeight:16},notice:{color:C.muted,fontSize:11,lineHeight:17},
  line:{borderTopWidth:1,borderTopColor:C.line,paddingTop:10,gap:4},lineWho:{color:C.gold,fontSize:8,fontWeight:'900',letterSpacing:1},lineText:{color:C.text,fontSize:13,lineHeight:19},footer:{color:'#707985',fontSize:8,textAlign:'center',letterSpacing:1.1},
});
