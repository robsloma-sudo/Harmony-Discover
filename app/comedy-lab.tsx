import { useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../src/auth/AuthContext';
import { supabase } from '../src/services/supabase';
import { comedyScenarios } from '../src/voice/comedyScenarios';

const rubric = [
  { key: 'specificity', label: 'Specific to the guest' },
  { key: 'originality', label: 'Originality / surprise' },
  { key: 'timing', label: 'Timing / punchline shape' },
  { key: 'natural_delivery', label: 'Natural spoken delivery' },
  { key: 'character_consistency', label: 'Bartender character consistency' },
  { key: 'restraint', label: "Restraint — didn't force the joke" },
] as const;
type ScoreKey = typeof rubric[number]['key'];
const C = { bg: '#090B0F', panel: '#141820', line: '#303741', gold: '#C6A36A', text: '#F0F1F2', muted: '#A0A7B0' };

export default function ComedyLabScreen() {
  const { session } = useAuth();
  const [index, setIndex] = useState(0);
  const [response, setResponse] = useState('');
  const [notes, setNotes] = useState('');
  const [scores, setScores] = useState<Partial<Record<ScoreKey, number>>>({});
  const [status, setStatus] = useState('');
  const [saved, setSaved] = useState(0);
  const scenario = comedyScenarios[index % comedyScenarios.length];
  const average = useMemo(() => {
    const values = rubric.map(r => scores[r.key]).filter((v): v is number => typeof v === 'number');
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }, [scores]);

  function next() {
    setIndex(v => (v + 1) % comedyScenarios.length);
    setResponse(''); setNotes(''); setScores({}); setStatus('');
  }

  async function save() {
    if (!session?.user?.id) { setStatus('Sign in to save a private human review.'); return; }
    if (!response.trim() || rubric.some(r => !scores[r.key])) {
      setStatus('Paste the actual response and score all six dimensions first.'); return;
    }
    const { error } = await supabase.from('bartender_comedy_evaluations').insert({
      user_id: session.user.id,
      scenario_id: scenario.id,
      scenario_version: 'marty-boston-v1.0.0',
      guest_prompt: scenario.guest,
      bartender_response: response.trim(),
      reviewer_notes: notes.trim(),
      specificity: scores.specificity,
      originality: scores.originality,
      timing: scores.timing,
      natural_delivery: scores.natural_delivery,
      character_consistency: scores.character_consistency,
      restraint: scores.restraint,
      rubric_version: 1,
    });
    if (error) { setStatus('Could not save. Confirm the DEV migration is applied and try again.'); return; }
    setSaved(v => v + 1); setStatus('Human evaluation saved to your private review history.');
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Pressable onPress={() => router.back()}><Text style={s.back}>‹ BACK TO DISCOVER</Text></Pressable>
      <Text style={s.kicker}>MARTY SULLIVAN · BOSTON PROFILE v1.0.0</Text>
      <Text style={s.title}>The Comedy Lab.</Text>
      <Text style={s.body}>Thirty-three original prompts. Six human-scored dimensions. No automatic grading and no model-weight training.</Text>
      <View style={s.stats}><Text style={s.stat}>{comedyScenarios.length} SCENARIOS</Text><Text style={s.stat}>6 DIMENSIONS</Text><Text style={s.stat}>{saved} SAVED</Text></View>
      <View style={s.card}>
        <Text style={s.kicker}>SCENARIO {index + 1} / {comedyScenarios.length} · {scenario.category.toUpperCase()}</Text>
        <Text style={s.difficulty}>{scenario.difficulty}</Text>
        <Text style={s.prompt}>“{scenario.guest}”</Text>
        <Text style={s.hint}>TEST FOR: {scenario.skill}</Text>
        <Pressable style={s.secondary} onPress={next}><Text style={s.secondaryText}>NEXT SCENARIO</Text></Pressable>
      </View>
      <View style={s.card}>
        <Text style={s.section}>Review the actual response</Text>
        <Text style={s.hint}>Run this prompt with Marty, then paste what he actually said. The Lab does not invent or auto-grade responses.</Text>
        <TextInput multiline value={response} onChangeText={setResponse} placeholder="Paste the actual bartender response…" placeholderTextColor="#707985" style={[s.input, { minHeight: 105 }]} />
        <Text style={s.section}>Six-dimension rubric</Text>
        {rubric.map(item => (
          <View key={item.key} style={s.rubricRow}>
            <Text style={s.rubricLabel}>{item.label}</Text>
            <View style={s.scoreRow}>
              {[1,2,3,4,5].map(n => (
                <Pressable key={n} onPress={() => setScores(old => ({ ...old, [item.key]: n }))} style={[s.score, scores[item.key] === n && s.scoreSelected]}>
                  <Text style={[s.scoreText, scores[item.key] === n && s.scoreTextSelected]}>{n}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        <Text style={s.average}>CURRENT AVERAGE: {average ? average.toFixed(1) : '—'} / 5</Text>
        <TextInput multiline value={notes} onChangeText={setNotes} placeholder="What worked, fell flat, felt forced, or sounded natural?" placeholderTextColor="#707985" style={[s.input, { minHeight: 75 }]} />
        <Pressable style={s.primary} onPress={() => void save()}><Text style={s.primaryText}>SAVE HUMAN REVIEW</Text></Pressable>
        {!!status && <Text style={s.status}>{status}</Text>}
      </View>
      <Text style={s.footer}>PRIVATE USER-SUBMITTED EVALUATIONS · NO AUTONOMOUS TRAINING</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg }, content: { padding: 20, paddingTop: 54, paddingBottom: 50, gap: 15 },
  back: { color: C.gold, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 }, kicker: { color: C.gold, fontSize: 9, letterSpacing: 1.8, fontWeight: '800', marginTop: 12 },
  title: { color: C.text, fontSize: 34, fontWeight: '800' }, body: { color: C.muted, fontSize: 13, lineHeight: 20 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line, paddingVertical: 12 },
  stat: { color: C.gold, fontSize: 9, fontWeight: '800', letterSpacing: 1 }, card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16, gap: 12 },
  difficulty: { color: C.muted, fontSize: 10 }, prompt: { color: C.text, fontSize: 21, lineHeight: 30, fontWeight: '600' }, hint: { color: C.muted, fontSize: 11, lineHeight: 17 },
  section: { color: C.text, fontSize: 16, fontWeight: '800', marginTop: 5 }, input: { backgroundColor: '#0D1117', borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 12, color: C.text, textAlignVertical: 'top', fontSize: 13 },
  secondary: { alignSelf: 'flex-start', borderWidth: 1, borderColor: C.gold, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 }, secondaryText: { color: C.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  rubricRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line, gap: 8 }, rubricLabel: { color: C.text, fontSize: 12 }, scoreRow: { flexDirection: 'row', gap: 8 },
  score: { width: 35, height: 35, borderRadius: 8, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }, scoreSelected: { backgroundColor: C.gold, borderColor: C.gold },
  scoreText: { color: C.muted, fontWeight: '700' }, scoreTextSelected: { color: '#111' }, average: { color: C.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  primary: { backgroundColor: C.gold, padding: 14, borderRadius: 9, alignItems: 'center' }, primaryText: { color: '#111', fontWeight: '900', fontSize: 11, letterSpacing: 1 }, status: { color: C.gold, fontSize: 11, lineHeight: 16 }, footer: { color: '#707985', fontSize: 8, textAlign: 'center', letterSpacing: 1.1 },
});
