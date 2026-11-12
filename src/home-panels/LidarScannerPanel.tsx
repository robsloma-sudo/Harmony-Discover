import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { DiscoverARSurface, type ARTrackingUpdate } from '../live/DiscoverARSurface';
import { getDiscoverARKitCapabilities, type ARKitCapabilities } from '../services/discoverARKit';

const ink = '#F1EEE7';
const muted = '#9DA7B5';
const brass = '#C6A36A';

export default function LidarScannerPanel({ onClose }: { onClose: () => void }) {
  const [capabilities, setCapabilities] = useState<ARKitCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(false);
  const [tracking, setTracking] = useState<ARTrackingUpdate>({ state: 'paused', reason: 'not_started' });
  const [recognition, setRecognition] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    getDiscoverARKitCapabilities().then(value => { if (mounted) setCapabilities(value); })
      .catch(e => { if (mounted) setError(e instanceof Error ? e.message : 'Could not read device capabilities.'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const supported = !!capabilities?.worldTrackingSupported;
  const lidar = !!capabilities?.sceneDepthSupported;
  const statusColor = tracking.state === 'normal' ? '#66E5A1' : '#E6B76C';

  return <View style={{ gap: 10 }}>
    <Text style={{ color: muted, fontSize: 10, lineHeight: 16 }}>NATIVE IPHONE AR SESSION · DEPTH CAPABILITY IS DETECTED AT RUNTIME</Text>
    {loading ? <ActivityIndicator color={brass}/> : <>
      <View style={{ padding: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)' }}>
        <Text style={{ color: ink, fontSize: 12, fontWeight: '800' }}>{capabilities?.machineIdentifier || (Platform.OS === 'web' ? 'Browser preview' : 'Native module unavailable')}</Text>
        <Text style={{ color: muted, fontSize: 10, marginTop: 4 }}>ARKit world tracking: {supported ? 'SUPPORTED' : 'UNAVAILABLE'}</Text>
        <Text style={{ color: muted, fontSize: 10, marginTop: 3 }}>LiDAR scene depth: {lidar ? 'SUPPORTED' : 'NOT REPORTED'}</Text>
        <Text style={{ color: muted, fontSize: 10, marginTop: 3 }}>Mesh reconstruction: {capabilities?.meshReconstructionSupported ? 'SUPPORTED' : 'NOT REPORTED'}</Text>
      </View>
      <View style={{ height: 210, overflow: 'hidden', borderRadius: 12, backgroundColor: '#030609', borderWidth: 1, borderColor: 'rgba(79,139,255,0.45)' }}>
        <DiscoverARSurface style={{ flex: 1 }} active={active}
          onTrackingUpdate={e => setTracking(e.nativeEvent)}
          onARError={e => { setError(e.nativeEvent.message || 'ARKit session failed.'); setActive(false); }}
          onRecognitionUpdate={e => setRecognition(e.nativeEvent.text || [])}
          onARReady={() => setError('')}
        />
        {!active && <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(3,6,9,0.72)' }}><Text style={{ color: ink, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>AR SESSION PAUSED</Text></View>}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: statusColor, fontSize: 10, fontWeight: '900' }}>TRACKING · {tracking.state.toUpperCase().replace('_',' ')}</Text>
        <Text style={{ color: muted, fontSize: 9 }}>{tracking.reason || 'Tracking stable'}</Text>
      </View>
      {!!recognition.length && <View style={{ padding: 9, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.04)' }}><Text style={{ color: brass, fontSize: 9, fontWeight: '900', marginBottom: 4 }}>LIVE TEXT READOUT</Text><Text style={{ color: ink, fontSize: 10, lineHeight: 15 }}>{recognition.slice(0,8).join(' · ')}</Text></View>}
    </>}
    {!!error && <Text style={{ color: '#F0A39B', fontSize: 10 }}>{error}</Text>}
    <Text style={{ color: muted, fontSize: 9, lineHeight: 14 }}>This first connection starts ARKit and displays tracking plus live Vision text. Depth-map extraction, mesh rendering and bottle 3D tracking are not connected yet.</Text>
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Pressable onPress={() => { setError(''); setActive(v => !v); }} style={{ flex: 1, padding: 12, borderRadius: 9, backgroundColor: active ? '#273343' : brass, alignItems: 'center' }}><Text style={{ color: active ? ink : '#101317', fontSize: 10, fontWeight: '900' }}>{active ? 'PAUSE AR SESSION' : 'START AR SESSION'}</Text></Pressable>
      <Pressable onPress={onClose} style={{ padding: 12, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' }}><Text style={{ color: ink, fontSize: 10, fontWeight: '800' }}>CLOSE</Text></Pressable>
    </View>
  </View>;
}
