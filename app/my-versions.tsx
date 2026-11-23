import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import { deleteMyVersion, listMyVersions, type MyVersion } from '../src/services/menuExplore';
import { BigActionButton, ExploreSheet, SectionEyebrow } from '../src/explore/ExploreKit';
import { palette, space, type } from '../src/explore/exploreTheme';

function confirmDelete(name: string, onYes: () => void) {
  if (Platform.OS === 'web') { if (typeof window !== 'undefined' && window.confirm(`Delete "${name}"?`)) onYes(); return; }
  Alert.alert('Delete this version?', name, [{ text: 'Keep it', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: onYes }]);
}

const savedOn = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString(); };

export default function MyVersions() {
  const [versions, setVersions] = useState<MyVersion[] | null>(null);
  const load = useCallback(() => { listMyVersions().then(setVersions).catch(() => setVersions([])); }, []);
  useEffect(load, [load]);
  return (
    <Screen hideTabs>
      <Text style={styles.back} onPress={() => router.back()}>‹  Back</Text>
      <SectionEyebrow>MY VERSIONS</SectionEyebrow>
      <Text style={{ ...type.hero, color: palette.ivory, marginTop: space.sm }}>Drinks you changed</Text>
      {versions && versions.length === 0 && <ExploreSheet style={{ marginTop: space.lg }}>
        <Text style={{ ...type.value, color: palette.ivory }}>Nothing saved yet.</Text>
        <Text style={{ ...type.body, color: palette.muted, marginTop: space.sm }}>Tap a drink on a scanned menu, change it, and choose "Save as my version". It will wait for you here.</Text>
      </ExploreSheet>}
      {(versions || []).map(v => <ExploreSheet key={v.id} style={{ marginTop: space.md, gap: space.md }}>
        <Text style={{ ...type.title, color: palette.ivory }}>{v.name}</Text>
        <Text style={{ ...type.caption, color: palette.muted }}>{v.change_types.length ? `Changes: ${v.change_types.map(c => c.replace(/_/g, ' ')).join(', ')}` : 'No changes yet'} · saved {savedOn(v.created_at)}</Text>
        <BigActionButton primary label="Open" icon="open-outline" onPress={() => router.push({ pathname: '/explore-cocktail', params: { versionId: v.id } } as never)} />
        <BigActionButton label="Delete" icon="trash-outline" onPress={() => confirmDelete(v.name, () => { void deleteMyVersion(v.id).then(load); })} />
      </ExploreSheet>)}
    </Screen>
  );
}
