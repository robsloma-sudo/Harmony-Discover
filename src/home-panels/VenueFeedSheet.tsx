import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { fetchVenueFeed, fetchVenueMenuPages, type DiscoverVenue, type MenuPagesView, type VenueFeed } from '../services/discoverVenueApi';
import { ATLAS_LAYERS } from '../services/phgAtlasRecords';
import { StreetViewEmbed } from './StreetViewEmbed';
import { VENUE_TYPE_COLORS, VENUE_TYPE_LABELS } from './AtlasMapGL.types';

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
};

/** Venue card on the Atlas: what people have scanned here recently (crowd-sourced, anonymous). */
export function VenueFeedSheet({ venue, checkedInHere, onClose }: { venue: DiscoverVenue; checkedInHere: boolean; onClose: () => void }) {
  const [feed, setFeed] = useState<VenueFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<MenuPagesView | null>(null);
  const [menuState, setMenuState] = useState<'loading' | 'done' | 'failed'>('loading');
  const [page, setPage] = useState<number | null>(null);
  // Menu pages: the same captured pages the Harmony Atlas venue card shows (PHG phg-discover-menu-pages).
  useEffect(() => {
    let live = true; setMenu(null); setMenuState('loading'); setPage(null);
    fetchVenueMenuPages(venue).then(v => { if (live) { setMenu(v); setMenuState('done'); } }).catch(() => { if (live) setMenuState('failed'); });
    return () => { live = false; };
  }, [venue.id]);
  useEffect(() => {
    let live = true; setLoading(true); setError(''); setFeed(null);
    fetchVenueFeed(venue.id).then(f => { if (live) setFeed(f); }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not load this venue.'); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [venue.id]);

  return <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '58%', borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: 'rgba(6,14,30,0.97)', borderWidth: 1, borderColor: 'rgba(74,137,255,0.55)', padding: 14 }}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      <View style={{ width: 12, height: 12, borderRadius: 6, marginTop: 4, marginRight: 8, backgroundColor: venue.atlas_layer ? ATLAS_LAYERS[venue.atlas_layer].color : VENUE_TYPE_COLORS[venue.venue_type] ?? '#3B82F6' }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#EAF2FF', fontSize: 15, fontWeight: '900' }}>{venue.name}</Text>
        <Text style={{ color: '#A8B7D0', fontSize: 10, marginTop: 2 }}>{VENUE_TYPE_LABELS[venue.venue_type] ?? 'Venue'} · {[venue.address_line, venue.locality, venue.region].filter(Boolean).join(', ')} · {venue.distance_miles.toFixed(1)} mi</Text>
        {venue.drink_items ? <Text style={{ color: '#A8B7D0', fontSize: 10, marginTop: 2 }}>{venue.drink_items} drinks on PHG's captured menu{venue.cocktail_items ? ` · ${venue.cocktail_items} cocktails` : ''}{venue.cocktail_avg_price ? ` · avg $${venue.cocktail_avg_price.toFixed(0)}` : ''}</Text> : null}
        {checkedInHere && <Text style={{ color: '#FFD166', fontSize: 9, fontWeight: '900', marginTop: 4 }}>YOU'RE CHECKED IN HERE</Text>}
      </View>
      <Pressable onPress={onClose} accessibilityLabel="Close venue" style={{ padding: 6 }}><Text style={{ color: '#8DBBFF', fontSize: 16, fontWeight: '900' }}>×</Text></Pressable>
    </View>
    <ScrollView style={{ marginTop: 10 }} contentContainerStyle={{ paddingBottom: 8 }}>
      <Text style={{ color: '#8DBBFF', fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginBottom: 6 }}>STREET VIEW · DRAG TO LOOK AROUND</Text>
      <StreetViewEmbed latitude={venue.latitude} longitude={venue.longitude} title={venue.name} height={200} />
      <View style={{ height: 12 }} />
      <Text style={{ color: '#8DBBFF', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 }}>MENU</Text>
      {menuState === 'loading' && <ActivityIndicator color="#8DBBFF" style={{ marginVertical: 6 }} />}
      {menuState === 'failed' && <Text style={{ color: '#91A9CB', fontSize: 10, marginTop: 4 }}>Menu pages couldn't load just now.</Text>}
      {menuState === 'done' && (menu?.type === 'menu_pages' && menu.pages?.length ? <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
          {menu.pages.map((pg, i) => <Pressable key={pg.url} onPress={() => setPage(i)} accessibilityLabel={`Open menu page ${i + 1}`}>
            <Image source={{ uri: pg.url }} style={{ width: 92, height: 124, borderRadius: 8, backgroundColor: '#0b1424' }} resizeMode="cover" />
            <Text style={{ color: '#91A9CB', fontSize: 8, marginTop: 2 }}>{i + 1}{/beverage|mixed/.test(pg.scope) ? ' · drinks' : ''}</Text>
          </Pressable>)}
        </ScrollView>
        <Text style={{ color: '#6F86A8', fontSize: 9 }}>{menu.note}</Text>
      </> : <Text style={{ color: '#91A9CB', fontSize: 10, marginTop: 4 }}>No menu pages captured for this venue yet. Scan theirs to add it.</Text>)}
      <View style={{ height: 12 }} />
      {loading && <ActivityIndicator color="#8DBBFF" />}
      {!!error && <Text style={{ color: '#E6A18F', fontSize: 10 }}>{error}</Text>}
      {feed && <>
        <Text style={{ color: '#8DBBFF', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 }}>BOTTLES SEEN HERE · LAST {feed.window_days} DAYS</Text>
        {feed.bottles.length ? feed.bottles.map((b, i) => <View key={i} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: 'rgba(74,137,255,0.15)' }}>
          <Text style={{ color: '#EAF2FF', fontSize: 12, fontWeight: '800' }}>{b.brand}{b.product ? ' ' + b.product : ''}{b.size ? ' · ' + b.size : ''}</Text>
          <Text style={{ color: '#91A9CB', fontSize: 9, marginTop: 2 }}>Seen {ago(b.last_seen_at)} · {b.people} {b.people === 1 ? 'person' : 'people'}{b.category ? ' · ' + b.category : ''}</Text>
        </View>) : <Text style={{ color: '#91A9CB', fontSize: 10, marginTop: 6 }}>No shared bottle scans yet. Check in and scan the shelf or back bar to start this venue's list.</Text>}
        <Text style={{ color: '#8DBBFF', fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginTop: 14 }}>MENUS SHARED HERE</Text>
        {feed.menus.length ? feed.menus.map(m => <View key={m.observation_id} style={{ marginTop: 6, padding: 9, borderRadius: 9, backgroundColor: 'rgba(14,25,44,0.8)' }}>
          <Text style={{ color: '#91A9CB', fontSize: 9 }}>Scanned {ago(m.captured_at)}</Text>
          {m.items.slice(0, 12).map((it, j) => <Text key={j} style={{ color: '#EAF2FF', fontSize: 11, marginTop: 3 }}>{it.name}{it.price ? `  ${it.price}` : ''}</Text>)}
          {m.items.length > 12 && <Text style={{ color: '#91A9CB', fontSize: 9, marginTop: 3 }}>+{m.items.length - 12} more</Text>}
        </View>) : <Text style={{ color: '#91A9CB', fontSize: 10, marginTop: 6 }}>No shared menu scans yet.</Text>}
        <Text style={{ color: '#6F86A8', fontSize: 9, marginTop: 12 }}>{feed.note || 'Crowd-sourced from Discover scans.'} {feed.contributors ? `${feed.contributors} contributor${feed.contributors === 1 ? '' : 's'}.` : ''}</Text>
      </>}
      <Pressable onPress={() => Linking.openURL('https://www.openstreetmap.org/?mlat=' + venue.latitude + '&mlon=' + venue.longitude + '#map=17/' + venue.latitude + '/' + venue.longitude)}>
        <Text style={{ color: '#8DBBFF', fontSize: 9, fontWeight: '900', marginTop: 10 }}>OPEN IN MAPS ↗</Text>
      </Pressable>
    </ScrollView>
    <Modal visible={page != null && !!menu?.pages?.length} transparent animationType="fade" onRequestClose={() => setPage(null)}>
      {page != null && menu?.pages?.[page] && <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 14 }}>
          <Text style={{ color: '#EAF2FF', fontSize: 12, fontWeight: '900', flex: 1 }}>{menu.title || venue.name} · page {page + 1} of {menu.pages.length}</Text>
          {page > 0 && <Pressable onPress={() => setPage(page - 1)} accessibilityLabel="Previous page"><Text style={{ color: '#EAF2FF', fontSize: 22 }}>‹</Text></Pressable>}
          {page < menu.pages.length - 1 && <Pressable onPress={() => setPage(page + 1)} accessibilityLabel="Next page"><Text style={{ color: '#EAF2FF', fontSize: 22 }}>›</Text></Pressable>}
          <Pressable onPress={() => Linking.openURL(menu.pages![page].url)}><Text style={{ color: '#8DBBFF', fontSize: 11, fontWeight: '900' }}>Full size ↗</Text></Pressable>
          <Pressable onPress={() => setPage(null)} accessibilityLabel="Close"><Text style={{ color: '#EAF2FF', fontSize: 18 }}>✕</Text></Pressable>
        </View>
        <ScrollView maximumZoomScale={4} minimumZoomScale={1} contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Image source={{ uri: menu.pages[page].url }} style={{ width: '100%', aspectRatio: (menu.pages[page].width || 3) / (menu.pages[page].height || 4) }} resizeMode="contain" />
        </ScrollView>
      </View>}
    </Modal>
  </View>;
}

export default VenueFeedSheet;
