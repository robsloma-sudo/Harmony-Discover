import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DiscoverARSurface, type ARTrackingUpdate } from '../live/DiscoverARSurface';

const ink = '#F1EEE7';
const brass = '#C6A36A';

export default function LidarScannerPanel({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState(false);
  const [tracking, setTracking] = useState<ARTrackingUpdate>({ state: 'paused', reason: 'not_started' });
  const [error, setError] = useState('');
  const statusColor = tracking.state === 'normal' ? '#66E5A1' : '#E6B76C';

  return <View style={{ width: '100%', flex: 1, minHeight: 0, justifyContent: 'space-between', paddingBottom: 2 }}>
    <View style={{ flex: 1, minHeight: 390, overflow: 'hidden', borderRadius: 12, backgroundColor: '#030609', borderWidth: 1, borderColor: 'rgba(79,139,255,0.45)' }}>
      <DiscoverARSurface style={{ flex: 1 }} active={active}
        onTrackingUpdate={e => setTracking(e.nativeEvent)}
        onARError={e => { setError(e.nativeEvent.message || 'AR session failed.'); setActive(false); }}
        onARReady={() => setError('')}
      />
      {!active && <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(3,6,9,0.72)' }}><Text style={{ color: ink, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>AR SESSION PAUSED</Text></View>}
    </View>

    <View style={{ width: '100%', alignItems: 'flex-start', marginTop: 14 }}>
      <Text style={{ color: statusColor, fontSize: 12, fontWeight: '900', letterSpacing: 0.5 }}>TRACKING · {tracking.state.toUpperCase().replace('_',' ')}</Text>
    </View>

    {!!error && <Text style={{ color: '#F0A39B', fontSize: 11, textAlign: 'center', marginTop: 8 }}>{error}</Text>}

    <View style={{ width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 12, marginBottom: 2 }}>
      <Pressable onPress={() => { setError(''); setActive(v => !v); }} style={{ minWidth: 220, maxWidth: '72%', paddingVertical: 14, paddingHorizontal: 20, borderRadius: 9, backgroundColor: active ? '#273343' : brass, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: active ? ink : '#101317', fontSize: 11, fontWeight: '900', textAlign: 'center' }}>{active ? 'PAUSE AR SESSION' : 'START AR SESSION'}</Text>
      </Pressable>
      <Pressable onPress={onClose} style={{ minWidth: 92, paddingVertical: 14, paddingHorizontal: 18, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: ink, fontSize: 11, fontWeight: '800', textAlign: 'center' }}>CLOSE</Text>
      </Pressable>
    </View>
  </View>;
}
