// Tappable drink lines for the menu review. Used by app/preview.tsx and the dev-only /dev-menu-explore page.
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { recordTap, type ExploreKind, type LinkedItem, type MenuLineLink } from '../services/menuExplore';
import { LinkedChip } from './ExploreKit';
import { palette, space } from './exploreTheme';

type LineItem = { id: string; name: string; category: string; section?: string | null; description?: string | null; price?: string | null };

/** Food lines stay as they are; everything else on a menu is a drink line. */
export const isDrinkLine = (item: { category: string }) => item.category !== 'food';

const go = (pathname: string, params: Record<string, string>) => router.push({ pathname, params } as never);
const isLinked = (link?: MenuLineLink) => link?.status === 'linked';
/** A chip is only tappable when it has something to open. */
const itemRef = (i: LinkedItem) => i.phg_product_id || null;

function tapped(observationId: string | null | undefined, link: MenuLineLink, kind: ExploreKind, ref: string) {
  if (!observationId) return;
  recordTap({ observation_id: observationId, line_id: link.line_id, item_kind: kind, item_ref: ref });
}

export function openCocktail(link: MenuLineLink, observationId?: string | null) {
  if (!link.cocktail) return;
  tapped(observationId, link, 'cocktail', link.cocktail.id);
  const params: Record<string, string> = { cocktail: link.cocktail.id, name: link.cocktail.name, line_id: link.line_id };
  if (observationId) params.observation_id = observationId;
  go('/explore-cocktail', params);
}
export function openJourney(link: MenuLineLink, kind: ExploreKind, ref: string, name: string, observationId?: string | null) {
  tapped(observationId, link, kind, ref);
  go('/journey', { kind, ref, name });
}
/** Tapping the line itself: the cocktail if there is one, otherwise its first item that has a ref. */
export function openLine(link?: MenuLineLink, observationId?: string | null) {
  if (!link || !isLinked(link)) return;
  if (link.cocktail) { openCocktail(link, observationId); return; }
  const first = link.items.find(i => itemRef(i));
  if (first) openJourney(link, first.kind, itemRef(first)!, first.name, observationId);
}

/** Marker plus chips shown under a drink line. Renders nothing for food lines. */
export function LinkedLineBlock({ item, link, observationId }: { item: LineItem; link?: MenuLineLink; observationId?: string | null }) {
  if (!isDrinkLine(item)) return null;
  if (!link || !isLinked(link)) return <Text style={{ color: palette.mutedDim, fontSize: 12 }}>Not linked yet</Text>;
  return <View style={{ gap: space.sm }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: palette.green }} />
      <Text style={{ color: palette.green, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 }}>LINKED</Text>
    </View>
    {link.cocktail ? <LinkedChip kind="cocktail" label={link.cocktail.name} linked onPress={() => openCocktail(link, observationId)} /> : null}
    {link.items.map((c, n) => {
      const ref = itemRef(c);
      return <LinkedChip key={`${c.name}-${n}`} kind={c.kind} label={c.name} linked={!!ref}
        onPress={ref ? () => openJourney(link, c.kind, ref, c.name, observationId) : undefined} />;
    })}
  </View>;
}

/** Title block of a line; tappable when linked. */
export function LineTitle({ item, link, observationId, children }: { item: LineItem; link?: MenuLineLink; observationId?: string | null; children: React.ReactNode }) {
  if (!isDrinkLine(item) || !link || !isLinked(link)) return <>{children}</>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}, tap to explore`} onPress={() => openLine(link, observationId)}>{children}</Pressable>;
}

/** Quiet note shown above the lines (for example when a guest's daily limit is reached). */
export function LinksNotice({ message }: { message?: string | null }) {
  if (!message) return null;
  return <Text style={{ color: palette.mutedDim, fontSize: 13, lineHeight: 18, marginBottom: space.sm }}>{message}</Text>;
}

/** Plain list used by the dev page. */
export function MenuLineList({ items, links, observationId, notice }: { items: LineItem[]; links: MenuLineLink[]; observationId?: string | null; notice?: string | null }) {
  return <View style={{ gap: 10 }}>
    <LinksNotice message={notice} />
    {items.map(item => {
      const link = links.find(l => l.line_id === item.id);
      return <View key={item.id} style={{ padding: 14, backgroundColor: '#171E27', borderRadius: 14, gap: 10 }}>
        <LineTitle item={item} link={link} observationId={observationId}>
          <Text style={{ color: '#F4F1E9', fontWeight: '700', fontSize: 15 }}>{item.name}</Text>
          <Text style={{ color: '#7D8995', fontSize: 11 }}>{item.category}</Text>
        </LineTitle>
        <LinkedLineBlock item={item} link={link} observationId={observationId} />
      </View>;
    })}
  </View>;
}
