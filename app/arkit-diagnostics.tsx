import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import { getDiscoverARKitCapabilities, type ARKitCapabilities } from '../src/services/discoverARKit';

function Capability({ label, value }: { label: string; value: boolean }) {
  return (
    <View style={styles.item}>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle}>{label}</Text>
      </View>
      <Text style={[styles.price, { color: value ? '#23865B' : '#A84343' }]}>{value ? 'SUPPORTED' : 'UNAVAILABLE'}</Text>
    </View>
  );
}

export default function ARKitDiagnostics() {
  const [data, setData] = useState<ARKitCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getDiscoverARKitCapabilities();
      setData(result);
      if (!result) setError('Native ARKit module is not present. Install an iOS development build; Expo Go and web preview cannot load this module.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read ARKit capabilities.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <Screen>
      <Text style={styles.back} onPress={() => router.back()}>‹  Back to settings</Text>
      <Text style={styles.eyebrow}>DISCOVER DEV · NATIVE TEST</Text>
      <Text style={styles.title}>ARKit diagnostics</Text>
      <Text style={styles.sub}>Runtime hardware capability report. This test does not start the camera or save scan data.</Text>
      {loading ? <View style={{ padding: 24, alignItems: 'center' }}><ActivityIndicator /><Text style={styles.categoryDesc}>Checking device capabilities…</Text></View> : null}
      {error ? <View style={[styles.item, { flexDirection: 'column', alignItems: 'flex-start' }]}><Text style={styles.itemTitle}>Native module unavailable</Text><Text style={styles.categoryDesc}>{error}</Text></View> : null}
      {data ? <>
        <View style={styles.item}><View style={{ flex: 1 }}><Text style={styles.itemTitle}>Hardware identifier</Text><Text style={styles.categoryDesc}>{data.machineIdentifier}</Text></View></View>
        <View style={styles.item}><View style={{ flex: 1 }}><Text style={styles.itemTitle}>Device / OS</Text><Text style={styles.categoryDesc}>{data.model} · iOS {data.systemVersion}</Text></View></View>
        <Capability label="ARKit world tracking" value={data.worldTrackingSupported} />
        <Capability label="Scene depth" value={data.sceneDepthSupported} />
        <Capability label="Smoothed scene depth" value={data.smoothedSceneDepthSupported} />
        <Capability label="Scene mesh reconstruction" value={data.meshReconstructionSupported} />
        <View style={styles.item}><View style={{ flex: 1 }}><Text style={styles.itemTitle}>LiDAR assumption</Text><Text style={styles.categoryDesc}>Never inferred from model name</Text></View><Text style={styles.price}>FALSE</Text></View>
        <View style={styles.item}><View style={{ flex: 1 }}><Text style={styles.itemTitle}>AR session</Text><Text style={styles.categoryDesc}>Not started by this diagnostic</Text></View><Text style={styles.price}>IDLE</Text></View>
      </> : null}
      <Pressable style={styles.primary} onPress={() => void refresh()}><Text style={styles.primaryText}>Run capability check again</Text></Pressable>
    </Screen>
  );
}
