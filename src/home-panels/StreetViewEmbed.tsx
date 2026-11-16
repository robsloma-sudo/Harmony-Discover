// Native fallback: the iPhone app has no embedded browser view yet, so Street View opens in Google Maps.
// The web build (StreetViewEmbed.web.tsx) shows it live inside the page.
import React from 'react';
import { Linking, Pressable, Text } from 'react-native';
import { streetViewAppUrl } from '../services/discoverVenueApi';

export function StreetViewEmbed({ latitude, longitude }: { latitude: number; longitude: number; height?: number; title?: string }) {
  return <Pressable onPress={() => Linking.openURL(streetViewAppUrl(latitude, longitude))}>
    <Text style={{ color: '#8DBBFF', fontSize: 10, fontWeight: '900' }}>OPEN STREET VIEW ↗</Text>
  </Pressable>;
}

export default StreetViewEmbed;
