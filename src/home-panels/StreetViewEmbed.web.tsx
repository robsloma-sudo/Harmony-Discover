// Live, draggable Google Street View inside the page (web). Same Maps Embed key and URL format as Harmony Atlas's
// Street View card. If Google has no imagery within ~50 m it shows its own notice inside the frame.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { getStreetViewKey, streetViewEmbedUrl } from '../services/discoverVenueApi';

export function StreetViewEmbed({ latitude, longitude, height = 220, title }: { latitude: number; longitude: number; height?: number; title?: string }) {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => { let live = true; getStreetViewKey().then(k => { if (live) setKey(k); }); return () => { live = false; }; }, []);
  if (key === null) return <View style={{ height, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#8DBBFF" /></View>;
  if (!key) return <Text style={{ color: '#91A9CB', fontSize: 10 }}>Street View isn't available right now.</Text>;
  return <View style={{ height, borderRadius: 10, overflow: 'hidden', backgroundColor: '#0b1424' }}>
    {React.createElement('iframe', {
      key: `${latitude.toFixed(6)},${longitude.toFixed(6)}`,
      title: title ? `Street View: ${title}` : 'Street View',
      src: streetViewEmbedUrl(key, latitude, longitude),
      style: { width: '100%', height: '100%', border: 0 },
      loading: 'lazy', allowFullScreen: true, referrerPolicy: 'no-referrer-when-downgrade',
    })}
  </View>;
}

export default StreetViewEmbed;
