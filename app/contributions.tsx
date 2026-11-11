import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  ActiveMenuContribution,
  listActiveMenuContributions,
  withdrawObservationContribution,
} from '../src/services/discoverObservationApi';

export default function Contributions() {
  const [items, setItems] = useState<ActiveMenuContribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listActiveMenuContributions());
      setMessage('');
    } catch {
      setMessage('Could not load your contribution permissions. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function withdraw(item: ActiveMenuContribution) {
    Alert.alert(
      'Withdraw permission?',
      'This stops this observation from entering any future Discover-to-Harmony review. If data was already promoted, a separate deletion review is required.',
      [
        { text: 'Keep permission', style: 'cancel' },
        { text: 'Withdraw', style: 'destructive', onPress: async () => {
          setBusyId(item.observationId);
          try {
            await withdrawObservationContribution(item.observationId);
            setItems(current => current.filter(value => value.observationId !== item.observationId));
            setMessage('Permission withdrawn. Any unpromoted staging record is blocked.');
          } catch {
            setMessage('Withdrawal could not be confirmed. Refresh and try again.');
          } finally { setBusyId(null); }
        } },
      ],
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#0B0F14' }} contentContainerStyle={{ padding: 20, paddingTop: 54, paddingBottom: 50, gap: 16 }}>
      <Pressable onPress={() => router.back()}><Text style={{ color: '#D5AE70', fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>‹ BACK TO SETTINGS</Text></Pressable>
      <Text style={{ color: '#D5AE70', fontSize: 9, letterSpacing: 1.8, fontWeight: '800' }}>HARMONY DISCOVER · PRIVACY</Text>
      <Text style={{ color: '#F0E9DD', fontSize: 30, fontWeight: '800' }}>Your contributions</Text>
      <Text style={{ color: '#A7B0BA', fontSize: 13, lineHeight: 20 }}>Manage the separate permissions you gave to contribute extracted menu details to a private review queue. This is not permission to publish a menu.</Text>
      {loading ? <ActivityIndicator color="#D5AE70" /> : items.length === 0 ? (
        <View style={{ backgroundColor: '#151B22', borderColor: '#303A45', borderWidth: 1, borderRadius: 14, padding: 16 }}>
          <Text style={{ color: '#F0E9DD', fontSize: 14, fontWeight: '700' }}>No active contribution permissions</Text>
          <Text style={{ color: '#A7B0BA', fontSize: 12, marginTop: 6 }}>You have not granted any active menu contribution permissions.</Text>
        </View>
      ) : items.map(item => (
        <View key={item.grantId} style={{ backgroundColor: '#151B22', borderColor: '#303A45', borderWidth: 1, borderRadius: 14, padding: 16, gap: 8 }}>
          <Text style={{ color: '#F0E9DD', fontSize: 15, fontWeight: '800' }}>{item.venueName}</Text>
          <Text style={{ color: '#A7B0BA', fontSize: 11 }}>Scan: {item.capturedAt ? new Date(item.capturedAt).toLocaleDateString() : 'Date unavailable'}</Text>
          <Text style={{ color: '#A7B0BA', fontSize: 11 }}>Permission: {item.policyVersion}</Text>
          <Text style={{ color: '#A7B0BA', fontSize: 11 }}>Review state: {item.status.replaceAll('_', ' ')}</Text>
          <Pressable disabled={busyId === item.observationId} onPress={() => void withdraw(item)} style={{ alignSelf: 'flex-start', borderWidth: 1, borderColor: '#C78378', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, opacity: busyId === item.observationId ? 0.5 : 1 }}>
            <Text style={{ color: '#D99A90', fontSize: 10, fontWeight: '800' }}>{busyId === item.observationId ? 'WITHDRAWING…' : 'WITHDRAW PERMISSION'}</Text>
          </Pressable>
        </View>
      ))}
      {!!message && <Text style={{ color: '#D5AE70', fontSize: 12, lineHeight: 18 }}>{message}</Text>}
      <Pressable onPress={() => void load()} style={{ alignSelf: 'flex-start', borderWidth: 1, borderColor: '#D5AE70', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 }}>
        <Text style={{ color: '#D5AE70', fontSize: 10, fontWeight: '800' }}>REFRESH</Text>
      </Pressable>
    </ScrollView>
  );
}
