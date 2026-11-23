// Tappable drink lines for the menu review. Used by app/preview.tsx and the dev-only /dev-menu-explore page.
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { recordExploreEvent, type ExploreKind, type MenuLineLink } from '../services/menuExplore';
import { LinkedChip } from './ExploreKit';
import { palette, space } from './exploreTheme';

type LineItem = { id: string; name: string; category: string; section?: string | null; description?: string | null; price?: string | null };

/** Food lines stay as they are; everything else on a menu is a drink line. */
export const isDrinkLine = (item: { category: string }) => item.category !== 'food';

const go = (pathname: string, params: Record<string, string>) => router.push({ pathname, params } as never);

export function openCocktail(item: { id: string; name: string }, cocktail: { refId: string; name: string }) {
  recordExploreEvent({ type: 'line_tap', itemKind: 'cocktail', refId: cocktail.refId });
  go('/explore-cocktail', { ref: cocktail.refId, name: cocktail.name, item: item.id });
}
export function openJourney(kind: ExploreKind, refId: string, name: string) {
  recordExploreEvent({ type: 'line_tap', itemKind: kind, refId });
  go('/journey', { kind, ref: refId, name });
}
/** Tapping the line itself: the cocktail if there is one, otherwise its first spirit/wine/beer. */
export function openLine(item: { id: string; name: string }, link?: MenuLineLink) {
  if (!link?.linked) return;
  if (link.cocktail) openCocktail(item, link.cocktail);
  else if (link.components[0]) openJourney(link.components[0].kind, link.components[0].refId, link.components[0].name);
}

/** Marker plus chips shown under a drink line. Renders nothing for food lines. */
export function LinkedLineBlock({ item, link }: { item: LineItem; link?: MenuLineLink }) {
  if (!isDrinkLine(item)) return null;
  if (!link?.linked) return <Text style={{ color: palette.mutedDim, fontSize: 12 }}>Not linked yet</Text>;
  return <View style={{ gap: space.sm }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: palette.green }} />
      <Text style={{ color: palette.green, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 }}>LINKED</Text>
    </View>
    {link.cocktail ? <LinkedChip kind="cocktail" label={link.cocktail.name} linked onPress={() => openCocktail(item, link.cocktail!)} /> : null}
    {link.components.map(c => <LinkedChip key={c.refId} kind={c.kind} label={c.name} linked onPress={() => openJourney(c.kind, c.refId, c.name)} />)}
  </View>;
}

/** Title block of a line; tappable when linked. */
export function LineTitle({ item, link, children }: { item: LineItem; link?: MenuLineLink; children: React.ReactNode }) {
  if (!isDrinkLine(item) || !link?.linked) return <>{children}</>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}, tap to explore`} onPress={() => openLine(item, link)}>{children}</Pressable>;
}

/** Plain list used by the dev page. */
export function MenuLineList({ items, links }: { items: LineItem[]; links: MenuLineLink[] }) {
  return <View style={{ gap: 10 }}>
    {items.map(item => {
      const link = links.find(l => l.itemId === item.id);
      return <View key={item.id} style={{ padding: 14, backgroundColor: '#171E27', borderRadius: 14, gap: 10 }}>
        <LineTitle item={item} link={link}>
          <Text style={{ color: '#F4F1E9', fontWeight: '700', fontSize: 15 }}>{item.name}</Text>
          <Text style={{ color: '#7D8995', fontSize: 11 }}>{item.category}</Text>
        </LineTitle>
        <LinkedLineBlock item={item} link={link} />
      </View>;
    })}
  </View>;
}
