import { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import { useScan } from '../src/state/ScanContext';
import { useAuth } from '../src/auth/AuthContext';
import { processMenuPhotos, saveMenuItemCorrection, DiscoveredMenuItem } from '../src/services/discoverObservationApi';

const reviewField = { backgroundColor: '#171B20', color: '#F2F0EA', borderWidth: 1, borderColor: '#39414A', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 } as const;

export default function Preview() {
  const { pages, source, clear } = useScan();
  const { session, loading } = useAuth();
  const [processing, setProcessing] = useState(false);
  const [noticeAccepted, setNoticeAccepted] = useState(false);
  const [items, setItems] = useState<DiscoveredMenuItem[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [observationId, setObservationId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [pageOrientations, setPageOrientations] = useState<Array<'portrait' | 'landscape' | 'square' | 'unknown'>>([]);

  useEffect(() => {
    let active = true;
    Promise.all(pages.map(uri => new Promise<'portrait' | 'landscape' | 'square' | 'unknown'>(resolve => {
      Image.getSize(uri, (width, height) => {
        if (Math.abs(width - height) < 2) resolve('square');
        else resolve(width > height ? 'landscape' : 'portrait');
      }, () => resolve('unknown'));
    }))).then(results => { if (active) setPageOrientations(results); });
    return () => { active = false; };
  }, [pages]);

  async function readMenu() {
    if (!session) { router.push({ pathname: '/sign-in', params: { next: '/preview' } }); return; }
    if (!noticeAccepted) { setMessage('Please confirm the menu-processing notice before continuing.'); return; }
    setProcessing(true); setMessage('');
    try {
      const result = await processMenuPhotos(pages, source);
      setObservationId(result.id);
      setItems(result.items || []);
      setEditingId(null);
      if (result.status !== 'ready_for_review') setMessage(`Scan status: ${result.status}. Some pages may need another attempt.`);
      if (!result.items?.length) setMessage('No readable menu items were returned. Try a clearer photo with the menu filling the frame.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not process this menu.'); }
    finally { setProcessing(false); }
  }

  async function saveCorrection(item: DiscoveredMenuItem) {
    if (!observationId) { setMessage('This scan has no saved observation ID. Please run the scan again.'); return; }
    setSavingId(item.id); setMessage('');
    try {
      const saved = await saveMenuItemCorrection(observationId, item.id, {
        name: item.name, section: item.section, description: item.description, price: item.price,
      });
      setItems(old => old?.map(x => x.id === item.id ? saved : x) || null);
      setEditingId(null);
      setMessage('Correction saved to your Discover scan.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Correction could not be saved. Your edits remain on this screen.'); }
    finally { setSavingId(null); }
  }

  return <Screen>
    <Text style={styles.back} onPress={() => router.back()}>‹  Back</Text>
    <Text style={styles.eyebrow}>MENU SCAN</Text>
    <Text style={styles.title}>{items ? 'Review the menu.' : 'Ready to read.'}</Text>
    <Text style={styles.sub}>{items ? 'These are the words our reader found in your photos. Check names and prices before using them.' : 'Your photos stay on this device until you choose to process them.'}</Text>
    <ScrollView horizontal style={{ maxHeight: 142 }} contentContainerStyle={{ gap: 10, paddingVertical: 10 }}>
      {pages.map((uri, i) => <View key={i} style={{ width: 104, gap: 5 }}>
        <Image source={{ uri }} resizeMode="cover" style={{ width: 104, height: 104, borderRadius: 12, borderWidth: 1, borderColor: '#39414A' }} />
        <Text style={{ color: '#D7B77A', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, textAlign: 'center' }}>
          {(pageOrientations[i] || 'detecting').toUpperCase()}
        </Text>
      </View>)}
    </ScrollView>
    {!items && <>
      <Pressable style={styles.secondary} onPress={() => router.push('/scan')}>
        <Text style={styles.secondaryText}>+ Add another page</Text>
      </Pressable>
      <Pressable onPress={() => setNoticeAccepted(v => !v)} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 16 }}>
        <View style={{ width: 22, height: 22, borderRadius: 5, borderWidth: 1, borderColor: noticeAccepted ? '#AEB7C1' : '#68717D', backgroundColor: noticeAccepted ? '#AEB7C1' : 'transparent', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#111', fontWeight: '900' }}>{noticeAccepted ? '✓' : ''}</Text></View>
        <Text style={[styles.categoryDesc, { flex: 1 }]}>I agree to have these menu photos securely uploaded to Discover and processed to transcribe the printed menu. This is separate from optional research or personalization consent.</Text>
      </Pressable>
      {!session && <Text style={styles.footnote}>You can capture photos first. A free account is required only when you choose to upload and read them.</Text>}
      <Pressable style={[styles.primary, (!noticeAccepted || processing || loading) && { opacity: 0.45 }]} disabled={!noticeAccepted || processing || loading} onPress={readMenu}>
        {processing ? <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><ActivityIndicator color="#111" /><Text style={styles.primaryText}>Reading your menu…</Text></View> : <Text style={styles.primaryText}>{session ? 'Read this menu' : 'Sign in to read this menu'}</Text>}
      </Pressable>
    </>}
    {!!message && <Text style={{ color: '#E3B6A9', fontSize: 12, lineHeight: 18, marginTop: 12 }}>{message}</Text>}
    {items && <>
      <Text style={styles.sectionTitle}>Review extracted items · {items.length}</Text>
      <Text style={styles.footnote}>Check the transcription carefully. Save each correction to update your private Discover scan and retain an audit of what changed.</Text>
      {items.map(item => <View key={item.id} style={[styles.item, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
        {editingId === item.id ? <>
          <Text style={styles.eyebrow}>CORRECT TRANSCRIPTION</Text>
          <TextInput value={item.name} onChangeText={value => setItems(old => old?.map(x => x.id === item.id ? { ...x, name: value } : x) || null)} placeholder="Drink or item name" placeholderTextColor="#858C95" style={reviewField} />
          <TextInput value={item.section || ''} onChangeText={value => setItems(old => old?.map(x => x.id === item.id ? { ...x, section: value || null } : x) || null)} placeholder="Menu section" placeholderTextColor="#858C95" style={reviewField} />
          <TextInput value={item.description || ''} onChangeText={value => setItems(old => old?.map(x => x.id === item.id ? { ...x, description: value || null } : x) || null)} placeholder="Description" placeholderTextColor="#858C95" multiline style={[reviewField, { minHeight: 64 }]} />
          <TextInput value={item.price || ''} onChangeText={value => setItems(old => old?.map(x => x.id === item.id ? { ...x, price: value || null } : x) || null)} placeholder="Price as printed" placeholderTextColor="#858C95" style={reviewField} />
          <Pressable style={[styles.primary, savingId === item.id && { opacity: 0.55 }]} disabled={savingId === item.id} onPress={() => saveCorrection(item)}>{savingId === item.id ? <ActivityIndicator color="#111" /> : <Text style={styles.primaryText}>Save correction</Text>}</Pressable>
          <Pressable style={styles.secondary} onPress={() => setEditingId(null)} disabled={savingId === item.id}><Text style={styles.secondaryText}>Keep editing later</Text></Pressable>
        </> : <>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{item.name}</Text>
              {!!item.section && <Text style={styles.categoryDesc}>{item.section}</Text>}
              {!!item.description && <Text style={styles.categoryDesc}>{item.description}</Text>}
              <Text style={styles.footnote}>{item.category.replace('_', ' ')} · {item.text_verified ? 'verified' : 'needs review'}</Text>
            </View>
            {!!item.price && <Text style={styles.price}>{item.price}</Text>}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable style={[styles.secondary, { flex: 1 }]} onPress={() => setEditingId(item.id)}><Text style={styles.secondaryText}>Edit transcription</Text></Pressable>
            <Pressable style={[styles.secondary, { flex: 1 }]} onPress={() => router.push({ pathname: '/journey', params: { itemId: item.id } })}><Text style={styles.secondaryText}>Explore item</Text></Pressable>
          </View>
        </>}
      </View>)}
      <Pressable style={styles.secondary} onPress={() => { clear(); router.replace('/'); }}><Text style={styles.secondaryText}>Finish scan</Text></Pressable>
    </>}
  </Screen>;
}
