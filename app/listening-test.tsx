// Hidden listening test (no link anywhere). Web only. Visible only when the server's probe says so.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../src/auth/AuthContext';
import { probeListeningTest, requestCompareSession } from '../src/voice/voiceCompareClient';
import type { CompareLetter } from '../src/voice/voiceCompareClient';
import { connectGemini, connectWebrtc, type TransportHandle } from '../src/listeningTest/transports';
import {
  LETTERS, TEST_LINES, failureMessage, loadScores, revealEnabled, saveScores,
  type Letter, type LetterState, type Score, type Scores,
} from '../src/listeningTest/logic';

const BG = '#090B0F', GOLD = '#C6A36A', IVORY = '#F0F1F2', MUTED = '#8A8F98', CARD = '#141821';
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
  const handleRef = useRef<TransportHandle | null>(null);
  const activeRef = useRef<Letter | null>(null);
  const attemptRef = useRef(0);
  const isWeb = Platform.OS === 'web';

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
    const letter = activeRef.current; activeRef.current = null;
    if (letter) setStates(s => ({ ...s, [letter]: 'idle' }));
  }, []);

  // Leaving the page or hiding the tab stops the microphone.
  useEffect(() => {
    if (!isWeb || typeof document === 'undefined') return;
    const onHide = () => { if (document.visibilityState === 'hidden') stopCurrent(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); stopCurrent(); };
  }, [isWeb, stopCurrent]);

  function fail(letter: Letter, status?: number) {
    setStates(s => ({ ...s, [letter]: 'failed' }));
    setMessages(m => ({ ...m, [letter]: failureMessage(letter, status) }));
  }

  async function start(letter: Letter) {
    stopCurrent();
    const attempt = attemptRef.current;
    activeRef.current = letter;
    setMessages(m => ({ ...m, [letter]: '' }));
    setStates(s => ({ ...s, [letter]: 'connecting' }));
    const result = await requestCompareSession({ supabaseUrl, accessToken: token, contender: letter as CompareLetter, mode: 'hands_free' });
    if (attempt !== attemptRef.current) return;
    if (!result.ok) { activeRef.current = null; fail(letter, result.status); return; }
    const grant = result.grant;
    const hooks = { onClosed: () => { if (attempt === attemptRef.current) { handleRef.current = null; activeRef.current = null; setStates(s => ({ ...s, [letter]: 'idle' })); setMessages(m => ({ ...m, [letter]: 'Connection ended.' })); } } };
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
      const r = await requestCompareSession({ supabaseUrl, accessToken: token, contender: letter, mode: 'hands_free', reveal: true });
      found[letter] = r.ok ? (r.grant.model ?? 'not given') : 'could not be revealed';
    }
    setModels(found); setRevealing(false);
    if (Object.values(found).some(v => v === 'could not be revealed')) setRevealMsg('Some models could not be revealed. Try again in a minute.');
  }

  if (!isWeb) return <View style={{ flex: 1, backgroundColor: BG, padding: 24, justifyContent: 'center' }}><Text style={{ color: IVORY, fontSize: 16 }}>The listening test runs in the web preview.</Text></View>;
  if (loading || probe === 'pending') return <View style={{ flex: 1, backgroundColor: BG }} />;
  if (probe === 'no') return <View style={{ flex: 1, backgroundColor: BG, padding: 24 }}><Text style={{ color: IVORY }}>Not found.</Text></View>;

  const canReveal = revealEnabled(scores) && !revealing;
  const btn = (on: boolean) => ({ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: GOLD, backgroundColor: on ? GOLD : 'transparent' }) as const;

  return <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ padding: 16, paddingBottom: 48, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
    <Text style={{ color: GOLD, fontSize: 20, marginBottom: 4 }}>Listening test</Text>
    <Text style={{ color: MUTED, marginBottom: 16 }}>Pick a letter, talk to it with the five lines below, then score it. Use headphones.</Text>
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
