import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { Screen, styles } from '../src/ui';
import { DiscoverARSurface, type ARTrackingUpdate } from '../src/live/DiscoverARSurface';

export default function ARKitLiveTest() {
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(false);
  const [tracking, setTracking] = useState<ARTrackingUpdate>({ state: 'paused', reason: 'not_started' });
  const [error, setError] = useState('');
  const [candidateCount, setCandidateCount] = useState(0);

  const start = async () => {
    setError('');
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError('Camera permission is required for the ARKit test.');
        return;
      }
    }
    setTracking({ state: 'limited', reason: 'starting' });
    setActive(true);
  };

  return (
    <Screen>
      <Text style={styles.back} onPress={() => { setActive(false); router.back(); }}>‹  Back to diagnostics</Text>
      <Text style={styles.eyebrow}>DISCOVER DEV · AR SESSION TEST</Text>
      <Text style={styles.title}>Live world tracking</Text>
      <Text style={styles.sub}>This test starts an on-device ARKit camera session and reports tracking quality. It does not detect bottles, draw object contours, record video, or save images.</Text>
      <View style={{ height: 380, overflow: 'hidden', borderRadius: 14, backgroundColor: '#050A12', borderWidth: 1, borderColor: '#34527A', marginVertical: 16 }}>
        <DiscoverARSurface
          style={{ flex: 1 }}
          active={active}
          onTrackingUpdate={event => setTracking(event.nativeEvent)}
          onVisualCandidates={event => setCandidateCount(event.nativeEvent.count)}
          onARError={event => { setError(event.nativeEvent.message || 'ARKit session failed.'); setActive(false); }}
          onARReady={() => setError('')}
        />
        {!active && <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,10,18,0.82)' }}>
          <Text style={{ color: '#EAF2FF', fontWeight: '800', letterSpacing: 1 }}>AR SESSION PAUSED</Text>
        </View>}
      </View>
      <View style={[styles.item, { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <Text style={styles.itemTitle}>Tracking state</Text>
        <Text style={styles.price}>{tracking.state.toUpperCase().replace('_', ' ')}</Text>
        <Text style={styles.categoryDesc}>{tracking.reason || 'Camera pose tracking is stable.'}</Text>
      </View>
      <View style={[styles.item, { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <Text style={styles.itemTitle}>Live geometry candidates</Text>
        <Text style={styles.price}>{active ? candidateCount + ' CANDIDATES' : 'INACTIVE'}</Text>
        <Text style={styles.categoryDesc}>Blue rectangles are Vision-detected rectangular regions, not confirmed bottles or measured bottle contours. They are refreshed from camera frames while the AR session is active.</Text>
      </View>
      {!!error && <Text style={styles.categoryDesc}>{error}</Text>}
      {!permission && <ActivityIndicator />}
      <Pressable style={styles.primary} onPress={() => void start()}><Text style={styles.primaryText}>START AR SESSION</Text></Pressable>
      <Pressable style={[styles.item, { justifyContent: 'center' }]} onPress={() => { setActive(false); setTracking({ state: 'paused', reason: 'user_paused' }); }}>
        <Text style={styles.itemTitle}>Pause session</Text>
      </Pressable>
    </Screen>
  );
}
