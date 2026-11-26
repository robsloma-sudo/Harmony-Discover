// Hidden listening test (no link anywhere). Web only. Visible only when the server's probe says so.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../src/auth/AuthContext';
import { probeListeningTest, requestCompareSession } from '../src/voice/voiceCompareClient';
import type { CompareLetter } from '../src/voice/voiceCompareClient';
import { getMartyAgeAnswer, subscribeMartyAge, type MartyAgeAnswer } from '../src/marty/martyAge';
import { LiveFace } from '../src/marty/faces/LiveFace';
import { useDriverTalking, useFaceDriver } from '../src/marty/faceRig/useFaceDriver';
import { requestFaceB } from '../src/listeningTest/faceBClient';
import { connectGemini, connectWebrtc, type TransportHandle } from '../src/listeningTest/transports';
import {
  DEFAULT_VOICE, FACE_DEMO_LINES, LETTERS, TEST_LINES, VOICE_PICKS, failureMessage, loadScores, notWiredMessage, revealEnabled, saveScores,
  type Letter, type LetterState, type Score, type Scores, type VoicePick,
} from '../src/listeningTest/logic';

const BG = '#090B0F', GOLD = '#C6A36A', IVORY = '#F0F1F2', MUTED = '#8A8F98', CARD = '#141821';
const FACE_SIZE = 150;
const MARTY_L = require('../assets/marty/marty-l.jpg');
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

export default function ListeningTest() {
  const { session, loading } = useAuth();
  const token = session?.access_token ?? '';
  const [probe, setProbe] = useState<'pending' | 'yes' | 'no'>('pending');
  const [scores, setScores] = useState<Scores>({});
  const [states, setStates] = useState<Record<Letter, LetterState>>({ A: 'idle', B: 'idle', C: 'idle' });
  const [messages, setMessages] = useState<Partial<Record<Letter, string>>>({});
  const [models, setModels] = useState<Partial<Record<Letter, string>>>({});
  const [revealMsg, setRevealMsg] = useState('');
  const [revealing, setRevealing] = useState(false);
  const [saved, setSaved] = useState(true);
  // Voice pick (P-20261126-0004): only on this hidden screen, starts on the current voice every visit.
  const [voice, setVoice] = useState<VoicePick>(DEFAULT_VOICE);
  // Face preview (P-20261126-0028): A = on-phone rig, B = live video from a Rob-only server path.
  const driver = useFaceDriver();
  const driverTalking = useDriverTalking(driver);
  const [faceB, setFaceB] = useState<{ busy: boolean; message: string; streamUrl?: string }>({ busy: false, message: '' });
  const faceBAttemptRef = useRef(0);
  const handleRef = useRef<TransportHandle | null>(null);
  const activeRef = useRef<Letter | null>(null);
  const attemptRef = useRef(0);
  const isWeb = Platform.OS === 'web';
  // Same 21+ answer as Marty: without a Yes on this device the listening test stays off.
  const [ageAnswer, setAgeAnswer] = useState<MartyAgeAnswer>(getMartyAgeAnswer());
  useEffect(() => { setAgeAnswer(getMartyAgeAnswer()); return subscribeMartyAge(setAgeAnswer); }, []);
  const ageConfirmed = ageAnswer === 'yes';

  useEffect(() => { setScores(loadScores()); }, []);

  useEffect(() => {
    if (!isWeb || loading) return;
    if (!token) { setProbe('no'); return; }
    let alive = true;
    void probeListeningTest({ supabaseUrl, accessToken: token }).then(ok => { if (alive) setProbe(ok ? 'yes' : 'no'); }).catch(() => { if (alive) setProbe('no'); });
    return () => { alive = false; };
  }, [isWeb, loading, token]);

  const stopCurrent = useCallback(() => {
    attemptRef.current += 1;
    handleRef.current?.stop(); handleRef.current = null;
    driver.detachAudio(); driver.stopScript();
    const letter = activeRef.current; activeRef.current = null;
    if (letter) setStates(s => ({ ...s, [letter]: 'idle' }));
  }, [driver]);

  const stopFaceB = useCallback(() => {
    faceBAttemptRef.current += 1;
    setFaceB({ busy: false, message: '' });
  }, []);

  // Leaving the page or hiding the tab stops the microphone.
  useEffect(() => {
    if (!isWeb || typeof document === 'undefined') return;
    const onHide = () => { if (document.visibilityState === 'hidden') { stopCurrent(); stopFaceB(); } };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); stopCurrent(); stopFaceB(); };
  }, [isWeb, stopCurrent, stopFaceB]);

  function fail(letter: Letter, status?: number, plain?: string) {
    setStates(s => ({ ...s, [letter]: 'failed' }));
    setMessages(m => ({ ...m, [letter]: plain ?? failureMessage(letter, status) }));
  }

  function pickVoice(next: VoicePick) {
    if (next === voice) return;
    stopCurrent();
    setVoice(next);
    setMessages({});
    setStates({ A: 'idle', B: 'idle', C: 'idle' });
  }

  async function start(letter: Letter) {
    stopCurrent();
    const attempt = attemptRef.current;
    activeRef.current = letter;
    setMessages(m => ({ ...m, [letter]: '' }));
    setStates(s => ({ ...s, [letter]: 'connecting' }));
    const result = await requestCompareSession({ supabaseUrl, accessToken: token, contender: letter as CompareLetter, mode: 'hands_free', ageConfirmed, voice });
    if (attempt !== attemptRef.current) return;
    if (!result.ok) { activeRef.current = null; fail(letter, result.status, result.keyMissing ? result.message : undefined); return; }
    const grant = result.grant;
    if (grant.provider === 'openai_realtime' && grant.connectHint !== 'realtime') {
      // GPT-Live has no browser keys; it needs the server to relay the connection first (see transports.ts).
      activeRef.current = null;
      setStates(s => ({ ...s, [letter]: 'failed' }));
      setMessages(m => ({ ...m, [letter]: notWiredMessage(letter) }));
      return;
    }
    const hooks = {
      onVoiceStream: (stream: MediaStream) => driver.attachStream(stream),
      onVoiceAnalyser: (node: AnalyserNode) => driver.attachAnalyser(node),
      onMartyText: (delta: string) => driver.pushMartyText(delta),
      onMartyTurnDone: () => driver.endMartyTurn(),
      onClosed: () => { if (attempt === attemptRef.current) { handleRef.current = null; activeRef.current = null; setStates(s => ({ ...s, [letter]: 'idle' })); setMessages(m => ({ ...m, [letter]: 'Connection ended.' })); } },
    };
    try {
      const handle = grant.provider === 'gemini_live'
        ? await connectGemini({ token: grant.ephemeralToken, hooks })
        : await connectWebrtc({ token: grant.ephemeralToken, hint: grant.connectHint, hooks });
      if (attempt !== attemptRef.current) { handle.stop(); return; }
      handleRef.current = handle;
      setStates(s => ({ ...s, [letter]: 'listening' }));
    } catch (e) {
      if (attempt !== attemptRef.current) return;
      activeRef.current = null;
      const status = (e as { status?: number })?.status;
      fail(letter, status);
    }
  }

  function playDemo(text: string) {
    stopCurrent();
    void driver.playScript(text, { speak: true }).catch(() => undefined);
  }

  async function startFaceB() {
    faceBAttemptRef.current += 1;
    const attempt = faceBAttemptRef.current;
    setFaceB({ busy: true, message: 'Starting B…' });
    const r = await requestFaceB({ supabaseUrl, accessToken: token, ageConfirmed, voice });
    if (attempt !== faceBAttemptRef.current) return;
    if (!r.ok) { setFaceB({ busy: false, message: r.message }); return; }
    if (r.streamUrl) { setFaceB({ busy: false, message: 'Option B is live.', streamUrl: r.streamUrl }); return; }
    // TODO(P-20261126-0028 backend contract): if only an SDP answer comes back, finish the WebRTC handshake here and attach the video track.
    setFaceB({ busy: false, message: 'Option B answered, but the app does not know how to play its video yet.' });
  }

  function setScore(letter: Letter, value: Score) {
    const next = { ...scores, [letter]: value };
    setScores(next);
    setSaved(saveScores(next));
  }

  async function reveal() {
    stopCurrent();
    setRevealing(true); setRevealMsg('');
    const found: Partial<Record<Letter, string>> = {};
    for (const letter of LETTERS) {
      const r = await requestCompareSession({ supabaseUrl, accessToken: token, contender: letter, mode: 'hands_free', reveal: true, ageConfirmed, voice });
      found[letter] = r.ok ? (r.grant.model ?? 'not given') : 'could not be revealed';
    }
    setModels(found); setRevealing(false);
    if (Object.values(found).some(v => v === 'could not be revealed')) setRevealMsg('Some models could not be revealed. Try again in a minute.');
  }

  if (!isWeb) return <View style={{ flex: 1, backgroundColor: BG, padding: 24, justifyContent: 'center' }}><Text style={{ color: IVORY, fontSize: 16 }}>The listening test runs in the web preview.</Text></View>;
  if (loading || probe === 'pending') return <View style={{ flex: 1, backgroundColor: BG }} />;
  if (probe === 'no') return <View style={{ flex: 1, backgroundColor: BG, padding: 24 }}><Text style={{ color: IVORY }}>Not found.</Text></View>;
  if (!ageConfirmed) return <View testID="listening-test-age-off" style={{ flex: 1, backgroundColor: BG, padding: 24 }}><Text style={{ color: IVORY }}>The listening test stays off until this device answers Yes to Marty's "Are you 21 or older?" question.</Text></View>;

  const canReveal = revealEnabled(scores) && !revealing;
  const faceState = driverTalking ? 'talking' : (LETTERS.some(l => states[l] === 'listening') ? 'listening' : 'idle');
  const faceBActive = faceB.busy || !!faceB.streamUrl;
  const btn = (on: boolean) => ({ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: GOLD, backgroundColor: on ? GOLD : 'transparent' }) as const;

  return <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ padding: 16, paddingBottom: 48, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
    <Text style={{ color: GOLD, fontSize: 20, marginBottom: 4 }}>Listening test</Text>
    <Text style={{ color: MUTED, marginBottom: 16 }}>Pick a letter, talk to it with the five lines below, then score it. Use headphones.</Text>
    <Text style={{ color: GOLD, marginBottom: 8, letterSpacing: 2, fontSize: 11 }}>FACE PREVIEW</Text>
    <View testID="listening-test-face-preview" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
      <View style={{ width: FACE_SIZE }}>
        <Text style={{ color: IVORY, marginBottom: 6 }}>A · on the phone</Text>
        <LiveFace state={faceState} size={FACE_SIZE} driver={driver} />
        <View style={{ gap: 6, marginTop: 8 }}>
          {FACE_DEMO_LINES.map(l => <Pressable key={l.id} testID={`face-demo-${l.id}`} accessibilityRole="button" onPress={() => playDemo(l.text)} style={[btn(false), { paddingVertical: 6, paddingHorizontal: 10 }]}>
            <Text style={{ color: IVORY, fontSize: 13 }}>{l.label}</Text>
          </Pressable>)}
        </View>
      </View>
      <View style={{ width: FACE_SIZE }}>
        <Text style={{ color: IVORY, marginBottom: 6 }}>B · live video</Text>
        <View style={{ width: FACE_SIZE, height: FACE_SIZE, borderRadius: FACE_SIZE / 2, overflow: 'hidden', backgroundColor: '#000' }}>
          {faceB.streamUrl
            ? React.createElement('video', { src: faceB.streamUrl, autoPlay: true, playsInline: true, muted: false, style: { width: FACE_SIZE, height: FACE_SIZE, objectFit: 'cover' } })
            : <Image source={MARTY_L} style={{ width: FACE_SIZE, height: FACE_SIZE, opacity: 0.35 }} resizeMode="cover" />}
        </View>
        <View style={{ marginTop: 8 }}>
          {faceBActive
            ? <Pressable accessibilityRole="button" onPress={stopFaceB} style={[btn(false), { paddingVertical: 6, paddingHorizontal: 10 }]}><Text style={{ color: IVORY, fontSize: 13 }}>Stop B</Text></Pressable>
            : <Pressable accessibilityRole="button" onPress={() => void startFaceB()} style={[btn(true), { paddingVertical: 6, paddingHorizontal: 10 }]}><Text style={{ color: BG, fontSize: 13 }}>Start B</Text></Pressable>}
        </View>
        <Text style={{ color: MUTED, marginTop: 6, fontSize: 13 }}>{faceB.message || ' '}</Text>
      </View>
    </View>
    <Text style={{ color: GOLD, marginBottom: 8, letterSpacing: 2, fontSize: 11 }}>VOICE</Text>
    <View testID="listening-test-voice-pick" accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
      {VOICE_PICKS.map(v => <Pressable key={v.id} testID={`listening-test-voice-${v.id}`} accessibilityRole="radio" accessibilityState={{ checked: voice === v.id }} onPress={() => pickVoice(v.id)} style={btn(voice === v.id)}>
        <Text style={{ color: voice === v.id ? BG : IVORY }}>{v.label}</Text>
      </Pressable>)}
    </View>
    {LETTERS.map(letter => {
      const st = states[letter];
      const score = scores[letter];
      return <View key={letter} style={{ backgroundColor: CARD, borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: IVORY, fontSize: 18 }}>{letter}</Text>
          {st === 'listening' || st === 'connecting'
            ? <Pressable accessibilityRole="button" onPress={stopCurrent} style={btn(false)}><Text style={{ color: IVORY }}>Stop</Text></Pressable>
            : <Pressable accessibilityRole="button" onPress={() => void start(letter)} style={btn(true)}><Text style={{ color: BG }}>Start {letter}</Text></Pressable>}
        </View>
        <Text style={{ color: st === 'listening' ? GOLD : MUTED, marginTop: 6 }}>
          {st === 'connecting' ? 'Connecting…' : st === 'listening' ? 'Connected. Listening.' : messages[letter] || ' '}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {[1, 2, 3, 4, 5].map(n => <Pressable key={n} accessibilityRole="button" onPress={() => setScore(letter, n)} style={btn(score === n)}><Text style={{ color: score === n ? BG : IVORY }}>{n}</Text></Pressable>)}
          <Pressable accessibilityRole="button" onPress={() => setScore(letter, 'failed')} style={btn(score === 'failed')}><Text style={{ color: score === 'failed' ? BG : IVORY }}>Could not start</Text></Pressable>
        </View>
        {models[letter] ? <Text style={{ color: GOLD, marginTop: 8 }}>{letter} is {models[letter]}</Text> : null}
      </View>;
    })}
    {!saved ? <Text style={{ color: MUTED, marginBottom: 8 }}>Scores could not be saved on this phone. They stay on screen for now.</Text> : null}
    <Pressable accessibilityRole="button" disabled={!canReveal} onPress={() => void reveal()} style={[btn(canReveal), { opacity: canReveal ? 1 : 0.4, alignSelf: 'flex-start', marginBottom: 8 }]}>
      <Text style={{ color: canReveal ? BG : IVORY }}>{revealing ? 'Revealing…' : 'Reveal'}</Text>
    </Pressable>
    {revealMsg ? <Text style={{ color: MUTED, marginBottom: 8 }}>{revealMsg}</Text> : null}
    <Text style={{ color: GOLD, marginTop: 16, marginBottom: 8, letterSpacing: 2, fontSize: 11 }}>SAY THESE, IN ORDER</Text>
    {TEST_LINES.map((l, i) => <View key={l.id} style={{ backgroundColor: CARD, borderRadius: 12, padding: 14, marginBottom: 8 }}>
      <Text style={{ color: MUTED, fontSize: 12 }}>{i + 1}. {l.title}</Text>
      <Text style={{ color: IVORY, marginTop: 4, fontSize: 15 }}>{l.say}</Text>
    </View>)}
  </ScrollView>;
}
