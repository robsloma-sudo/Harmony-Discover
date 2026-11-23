import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { listMyVersions } from '../src/services/menuExplore';
import { getCurrentDrink } from '../src/explore/currentDrink';

const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);

// Pure black and white, huge type, so it can be read across a bar. No venue anywhere.
// Shows the server's own bartender_card text, from a saved version or the latest change.
export default function ShowBartender() {
  const p = useLocalSearchParams<{ versionId?: string }>();
  const versionId = one(p.versionId);
  const [drink, setDrink] = useState<{ name: string; card: string } | null>(() => {
    const c = versionId ? null : getCurrentDrink();
    return c ? { name: c.name, card: c.changed.bartender_card } : null;
  });
  useEffect(() => {
    if (!versionId) return;
    let live = true;
    listMyVersions().then(vs => { const v = vs.find(x => x.id === versionId); if (live && v) setDrink({ name: v.name, card: v.bartender_card }); })
      .catch(() => { const c = getCurrentDrink(); if (live && c) setDrink({ name: c.name, card: c.changed.bartender_card }); });
    return () => { live = false; };
  }, [versionId]);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 56, paddingBottom: 40 }}>
        {!drink ? <Text style={{ color: '#fff', fontSize: 32, fontWeight: '900' }}>No recipe to show.</Text> : <>
          <Text style={{ color: '#fff', fontSize: 48, fontWeight: '900', lineHeight: 54 }}>{drink.name}</Text>
          <Text style={{ color: '#fff', fontSize: 30, fontWeight: '800', lineHeight: 40, marginTop: 28 }}>{drink.card}</Text>
        </>}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close}
        style={{ margin: 16, marginBottom: 28, minHeight: 72, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#000', fontSize: 28, fontWeight: '900' }}>Close</Text>
      </Pressable>
    </View>
  );
}
