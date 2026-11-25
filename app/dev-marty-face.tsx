// Dev-only preview of Marty's animated face (all four states). ?state=idle|listening|thinking|talking shows one big face.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { MartyFace } from '../src/marty/MartyFace';
import type { MartyFaceState } from '../src/marty/faceTypes';

const STATES: MartyFaceState[] = ['idle', 'listening', 'thinking', 'talking'];
const BG = '#090B0F', GOLD = '#C6A36A', IVORY = '#F0F1F2';

export default function DevMartyFace() {
  const allowed = __DEV__ || process.env.EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK === '1';
  const { state: q } = useLocalSearchParams<{ state?: string }>();
  const [state, setState] = useState<MartyFaceState>('idle');
  const [mouth, setMouth] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => {
      const t = (Date.now() - t0) / 1000;
      setMouth(Math.max(0, Math.min(1, 0.5 + 0.35 * Math.sin(t * 9) + 0.2 * Math.sin(t * 3.7))));
    }, 40);
    return () => clearInterval(id);
  }, []);
  if (!allowed) return null;
  const only = STATES.find(s => s === q);
  const label = { color: GOLD, letterSpacing: 2, fontSize: 11, marginTop: 6 } as const;
  if (only) {
    return <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
      <MartyFace state={only} mouthOpen={mouth} size={340} />
      <Text style={label}>{only.toUpperCase()}</Text>
    </View>;
  }
  return <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ padding: 16, alignItems: 'center' }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', width: 340 }}>
      {STATES.map(s => <View key={s} style={{ width: 160, alignItems: 'center', marginBottom: 14 }}>
        <MartyFace state={s} mouthOpen={mouth} size={150} />
        <Text style={label}>{s.toUpperCase()}</Text>
      </View>)}
    </View>
    <View style={{ marginTop: 10, alignItems: 'center' }}>
      <MartyFace state={state} mouthOpen={mouth} size={260} />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {STATES.map(s => <Pressable key={s} onPress={() => setState(s)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: GOLD, backgroundColor: s === state ? GOLD : 'transparent' }}>
          <Text style={{ color: s === state ? BG : IVORY, fontSize: 12 }}>{s}</Text>
        </Pressable>)}
      </View>
      <View style={{ flexDirection: 'row', gap: 24, marginTop: 24, alignItems: 'center' }}>
        <MartyFace state="idle" mouthOpen={0} size={64} /><MartyFace state={state} mouthOpen={mouth} size={64} />
      </View>
    </View>
  </ScrollView>;
}
