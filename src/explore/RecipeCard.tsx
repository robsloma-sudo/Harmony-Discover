// Plain recipe lines shared by the cocktail maker, bartender card and make-at-home page.
import { Text, View } from 'react-native';
import type { Recipe, RecipeLine } from '../services/menuExplore';
import { palette, space, type } from './exploreTheme';

/** Amounts come from the server as text, e.g. "2 oz". Null before the first change. */
export const amountText = (l: RecipeLine): string => (l.amount || '').trim();

/** "about 18% alcohol" when the server gave an estimate. */
export function abvText(r?: Recipe | null): string {
  return r && typeof r.est_abv === 'number' && r.est_abv > 0 ? `about ${Math.round(r.est_abv)}% alcohol` : '';
}

export function IngredientList({ lines }: { lines: RecipeLine[] }) {
  return <View>
    {lines.map((l, n) => <View key={`${l.ingredient}-${n}`} style={{ flexDirection: 'row', gap: space.md, paddingVertical: 6 }}>
      <Text style={{ ...type.value, color: palette.brass, minWidth: 84 }}>{amountText(l)}</Text>
      <Text style={{ ...type.value, color: palette.ivory, flex: 1 }}>{l.ingredient}</Text>
    </View>)}
  </View>;
}

/** The method is one paragraph; show it as numbered steps. */
export function methodSteps(method?: string | null): string[] {
  return (method || '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}
