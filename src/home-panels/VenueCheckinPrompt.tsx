import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, Text, View } from 'react-native';
import type { CheckinPromptState } from '../services/useVenueCheckin';
import type { DiscoverVenue, CheckinSelection } from '../services/discoverVenueApi';
import { VENUE_TYPE_COLORS, VENUE_TYPE_LABELS } from './AtlasMapGL.types';

const distanceText = (m: number) => m < 1000 ? `${m} m away` : `${(m / 1609.344).toFixed(1)} mi away`;

export function VenueCheckinPrompt({ state, busy, error, onConfirm, onDismiss }: {
  state: CheckinPromptState;
  busy: boolean;
  error: string;
  onConfirm: (venue: DiscoverVenue, selection: CheckinSelection, shareScans: boolean) => void;
  onDismiss: () => void;
}) {
  const { decision } = state;
  const suggested = decision.status === 'suggest' ? decision.suggested : null;
  const list = decision.alternatives;
  const [picked, setPicked] = useState<string | null>(suggested?.venue.id ?? null);
  const [share, setShare] = useState(false);
  useEffect(() => { setPicked(suggested?.venue.id ?? null); }, [suggested?.venue.id]);
  const all = suggested ? [suggested, ...list] : list;
  const chosen = all.find(c => c.venue.id === picked) ?? null;
  const title = suggested ? `Are you at ${suggested.venue.name}?` : decision.status === 'choose' && decision.reason === 'low_accuracy' ? 'Where are you?' : 'Which place are you at?';

  return <View accessibilityViewIsModal style={{ position: 'absolute', zIndex: 80, left: 8, right: 8, bottom: 90, padding: 14, borderRadius: 16, backgroundColor: 'rgba(6,14,30,0.97)', borderWidth: 1, borderColor: 'rgba(74,137,255,0.7)' }}>
    <Text style={{ color: '#8DBBFF', fontSize: 9, fontWeight: '900', letterSpacing: 1.4 }}>CHECK IN</Text>
    <Text style={{ color: '#EAF2FF', fontSize: 16, fontWeight: '900', marginTop: 4 }}>{title}</Text>
    {decision.status === 'choose' && decision.reason === 'low_accuracy' && <Text style={{ color: '#A8B7D0', fontSize: 10, marginTop: 3 }}>Your location is rough (±{decision.accuracyM} m), so pick the right place.</Text>}
    <View style={{ marginTop: 10, gap: 6 }}>
      {all.map(c => {
        const on = c.venue.id === picked;
        return <Pressable key={c.venue.id} onPress={() => setPicked(c.venue.id)} accessibilityRole="radio" accessibilityState={{ checked: on }}
          style={{ flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: on ? '#FFD166' : 'rgba(74,137,255,0.3)', backgroundColor: on ? 'rgba(40,70,120,0.55)' : 'rgba(14,25,44,0.7)' }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, marginRight: 9, backgroundColor: VENUE_TYPE_COLORS[c.venue.venue_type] ?? '#3B82F6' }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#EAF2FF', fontSize: 12, fontWeight: '800' }}>{c.venue.name}</Text>
            <Text style={{ color: '#91A9CB', fontSize: 9, marginTop: 2 }}>{VENUE_TYPE_LABELS[c.venue.venue_type] ?? 'Venue'} · {distanceText(c.distanceM)}{c.venue.address_line ? ' · ' + c.venue.address_line : ''}</Text>
          </View>
        </Pressable>;
      })}
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
      <Switch value={share} onValueChange={setShare} accessibilityLabel="Share what I scan here on the venue's public page" />
      <Text style={{ color: '#C9D6EA', fontSize: 10, marginLeft: 8, flex: 1, lineHeight: 14 }}>Share the bottles and menus I scan here on this venue's public page. No name, no photos of you. You can undo it.</Text>
    </View>
    <Text style={{ color: '#6F86A8', fontSize: 9, marginTop: 6 }}>Discover saves the place you pick, not your GPS position.</Text>
    {!!error && <Text style={{ color: '#E6A18F', fontSize: 10, marginTop: 6 }}>{error}</Text>}
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
      <Pressable onPress={onDismiss} disabled={busy} style={{ flex: 1, padding: 11, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(74,137,255,0.5)' }}>
        <Text style={{ color: '#C9D6EA', fontSize: 11, fontWeight: '900' }}>NOT HERE</Text>
      </Pressable>
      <Pressable onPress={() => chosen && onConfirm(chosen.venue, suggested && chosen.venue.id === suggested.venue.id ? 'suggested' : 'chosen_from_list', share)} disabled={!chosen || busy}
        style={{ flex: 2, padding: 11, borderRadius: 10, alignItems: 'center', backgroundColor: chosen ? '#FFD166' : 'rgba(255,209,102,0.3)' }}>
        {busy ? <ActivityIndicator color="#111" /> : <Text style={{ color: '#111', fontSize: 11, fontWeight: '900' }}>{chosen ? `CHECK IN AT ${chosen.venue.name.toUpperCase().slice(0, 28)}` : 'PICK A PLACE'}</Text>}
      </Pressable>
    </View>
  </View>;
}

export default VenueCheckinPrompt;
