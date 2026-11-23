// Dev-only preview of the tappable menu lines with sample data (needs EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK=1).
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import { getMenuLinks, prefetchJourneys, type MenuLineLink } from '../src/services/menuExplore';
import { MenuLineList } from '../src/explore/MenuLineList';

const items = [
  { id: 'a', name: 'Old Fashioned with Buffalo Trace', category: 'cocktail', price: '$14' },
  { id: 'b', name: 'Negroni', category: 'cocktail', price: '$13' },
  { id: 'c', name: 'Pinot Noir (glass)', category: 'wine', price: '$12' },
  { id: 'd', name: 'Pilsner', category: 'beer', price: '$7' },
  { id: 'e', name: 'House Gimlet', category: 'cocktail', price: '$13' },
  { id: 'f', name: 'Fried Pickles', category: 'food', price: '$9' },
];
export default function DevMenuExplore() {
  const allowed = __DEV__ || process.env.EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK === '1';
  const [links, setLinks] = useState<MenuLineLink[]>([]);
  useEffect(() => { getMenuLinks('dev', items).then(l => { setLinks(l); void prefetchJourneys(l); }).catch(() => {}); }, []);
  if (!allowed) return null;
  return <Screen hideTabs>
    <Text style={styles.back} onPress={() => router.back()}>‹  Back</Text>
    <Text style={styles.eyebrow}>DEV PREVIEW · SAMPLE MENU</Text>
    <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Review extracted items · {items.length}</Text>
    <MenuLineList items={items} links={links} />
  </Screen>;
}
