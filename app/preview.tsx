import { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import { router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import { useScan } from '../src/state/ScanContext';
import { processMenuPhotos, saveMenuItemCorrection, getObservationContribution, grantObservationContribution, withdrawObservationContribution, confirmObservationVenue, DiscoveredMenuItem } from '../src/services/discoverObservationApi';

const reviewField = { backgroundColor: '#171B20', color: '#F2F0EA', borderWidth: 1, borderColor: '#39414A', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 } as const;

export default function Preview() {
  const { pages, source, clear, removePage } = useScan();
  const [processing, setProcessing] = useState(false);
  const [noticeAccepted, setNoticeAccepted] = useState(false);
  const [items, setItems] = useState<DiscoveredMenuItem[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [observationId, setObservationId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [pageOrientations, setPageOrientations] = useState<Array<'portrait' | 'landscape' | 'square' | 'unknown'>>([]);
  const [contributionGranted, setContributionGranted] = useState(false);
  const [venueName, setVenueName] = useState('');
  const [venueConfirmed, setVenueConfirmed] = useState(false);
  const [contributionBusy, setContributionBusy] = useState(false);

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
    if (!pages.length) { setMessage('Add at least one menu photo before reading.'); return; }
    if (!noticeAccepted) { setMessage('Please confirm the menu-processing notice before continuing.'); return; }
    setProcessing(true); setMessage('');
    try {
      const result = await processMenuPhotos(pages, source, setMessage);
      setObservationId(result.id);
      setItems(result.items || []);
      setContributionGranted(false);
      setVenueName(result.venue_name_read || '');
      setVenueConfirmed(false);
      if (result.status === 'ready_for_review') {
        try { const permission = await getObservationContribution(result.id); setContributionGranted(permission.granted); }
        catch { setMessage('Menu read succeeded, but contribution-permission status could not be checked.'); }
      }
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
      {pages.map((uri, i) => <View key={`${uri}-${i}`} style={{ width: 104, gap: 5 }}>
        <View style={{ width: 104, height: 104 }}>
          <Image source={{ uri }} resizeMode="contain" style={{ width: 104, height: 104, borderRadius: 12, borderWidth: 1, borderColor: '#39414A', backgroundColor: '#101419' }} />
          {!items && <Pressable accessibilityRole="button" accessibilityLabel={`Remove page ${i + 1}`} onPress={() => removePage(i)} style={{ position: 'absolute', top: 5, right: 5, width: 25, height: 25, borderRadius: 13, backgroundColor: 'rgba(8,10,13,0.9)', borderWidth: 1, borderColor: '#D7B77A', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#F2F0EA', fontSize: 16, lineHeight: 19 }}>×</Text></Pressable>}
        </View>
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
      {pages.length === 0 && <Text style={styles.footnote}>No photos selected. Add a page to continue.</Text>}
      <Pressable style={[styles.primary, (!pages.length || !noticeAccepted || processing) && { opacity: 0.45 }]} disabled={!pages.length || !noticeAccepted || processing} onPress={readMenu}>
        {processing ? <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><ActivityIndicator color="#111" /><Text style={styles.primaryText}>Reading your menu…</Text></View> : <Text style={styles.primaryText}>Read this menu</Text>}
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
            <Pressable style={[styles.secondary, { flex: 1 }]} onPress={() => router.push({ pathname: '/journey', params: { itemId: item.id, source: 'discover', entityType: 'menu_item', title: item.name, category: item.category, section: item.section || '', description: item.description || '', price: item.price || '' } })}><Text style={styles.secondaryText}>Explore item</Text></Pressable>
          </View>
        </>}
      </View>)}
      <View style={{ marginTop: 18, padding: 14, borderWidth: 1, borderColor: '#39414A', borderRadius: 12, gap: 10 }}>
        <Text style={styles.eyebrow}>VENUE VERIFICATION</Text>
        <Text style={styles.itemTitle}>Confirm where this menu came from.</Text>
        <Text style={styles.categoryDesc}>Check the venue name carefully. Harmony research needs a confirmed source, not a guess from the image reader.</Text>
        <TextInput value={venueName} onChangeText={value => { setVenueName(value); setVenueConfirmed(false); }} placeholder="Venue name" placeholderTextColor="#858C95" style={reviewField} />
        {venueConfirmed ? <Text style={{ color: '#B9D6C0', fontSize: 13, fontWeight: '700' }}>Venue confirmed: {venueName}</Text> :
          <Pressable style={[styles.secondary, (!venueName.trim() || contributionBusy) && { opacity: 0.5 }]} disabled={!venueName.trim() || contributionBusy || !observationId} onPress={async () => {
            if (!observationId) return;
            setContributionBusy(true); setMessage('');
            try { await confirmObservationVenue(observationId, venueName.trim()); setVenueConfirmed(true); setMessage('Venue identity confirmed for this scan.'); }
            catch (e) { setMessage(e instanceof Error ? e.message : 'Could not confirm this venue.'); }
            finally { setContributionBusy(false); }
          }}><Text style={styles.secondaryText}>{contributionBusy ? 'Saving…' : 'Confirm venue'}</Text></Pressable>}
      </View>
      <View style={{ marginTop: 18, padding: 14, borderWidth: 1, borderColor: '#66563D', borderRadius: 12, gap: 10 }}>
        <Text style={styles.eyebrow}>OPTIONAL · SEPARATE PERMISSION</Text>
        <Text style={styles.itemTitle}>Contribute this menu to Harmony research?</Text>
        <Text style={styles.categoryDesc}>Only the extracted menu details shown above (item names, descriptions, prices, your confirmed venue name and scan date) may be sent to a private Harmony review queue. A person must review them before any approved information can become canonical Harmony knowledge or appear in Harmony Journeys. This does not publish the menu or update either application automatically.</Text>
        <Text style={styles.categoryDesc}>Your menu photos, personal conversations, private memories and account details are not included in this contribution. The scan's venue identity, menu sections, item categories, printed details, and corrections you saved may be included. This choice is separate from permission to process the photos for your scan.</Text>
        {contributionGranted ? <>
          <Text style={{ color: '#B9D6C0', fontSize: 13, fontWeight: '700' }}>Contribution permission is active for this scan.</Text>
          <Pressable style={styles.secondary} disabled={contributionBusy} onPress={async () => {
            if (!observationId) return;
            setContributionBusy(true); setMessage('');
            try { await withdrawObservationContribution(observationId); setContributionGranted(false); setMessage('Contribution permission withdrawn for this scan.'); }
            catch (e) { setMessage(e instanceof Error ? e.message : 'Could not withdraw contribution permission.'); }
            finally { setContributionBusy(false); }
          }}><Text style={styles.secondaryText}>{contributionBusy ? 'Withdrawing…' : 'Withdraw contribution permission'}</Text></Pressable>
        </> : <>
          <Text style={styles.categoryDesc}>Confirm the venue above first. Nothing is contributed unless you choose the button below. You can withdraw permission later. Withdrawal blocks pending Discover review; if information has already been promoted to Harmony, removal requires a separate deletion review.</Text>
          <Pressable style={[styles.primary, (contributionBusy || !observationId) && { opacity: 0.5 }]} disabled={contributionBusy || !observationId || items.length === 0 || !venueConfirmed} onPress={async () => {
            if (!observationId) return;
            setContributionBusy(true); setMessage('');
            try { await grantObservationContribution(observationId); setContributionGranted(true); setMessage('Your separate contribution permission has been saved. The menu is not yet approved or published.'); }
            catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save contribution permission.'); }
            finally { setContributionBusy(false); }
          }}><Text style={styles.primaryText}>{contributionBusy ? 'Saving permission…' : 'Yes, allow this menu for research'}</Text></Pressable>
        </>}
      </View>
      <Pressable style={styles.secondary} onPress={() => { clear(); router.replace('/'); }}><Text style={styles.secondaryText}>Finish scan</Text></Pressable>
    </>}
  </Screen>;
}
