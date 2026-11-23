// Plain recipe lines shared by the cocktail maker and the make-at-home page.
import { Text, View } from 'react-native';
import type { CocktailRecipe, RecipeIngredient } from '../services/menuExplore';
import { palette, space, type } from './exploreTheme';

const NICE_UNIT: Record<string, string> = { dashes: 'dashes', dash: 'dash' };
export function amountText(i: RecipeIngredient): string {
  if (i.amount == null) return '';
  const n = Math.round(i.amount * 100) / 100;
  return `${n}${i.unit ? ' ' + (NICE_UNIT[i.unit] || i.unit) : ''}`;
}

export function IngredientList({ ingredients }: { ingredients: RecipeIngredient[] }) {
  return <View>
    {ingredients.map((i, n) => <View key={`${i.name}-${n}`} style={{ flexDirection: 'row', gap: space.md, paddingVertical: 6 }}>
      <Text style={{ ...type.value, color: palette.brass, minWidth: 84 }}>{amountText(i)}</Text>
      <Text style={{ ...type.value, color: palette.ivory, flex: 1 }}>{i.name}</Text>
    </View>)}
  </View>;
}

export function parseRecipeParam(raw?: string): CocktailRecipe | null {
  try { const r = JSON.parse(raw || ''); return r && Array.isArray(r.ingredients) ? r as CocktailRecipe : null; } catch { return null; }
}

/** The method is one paragraph; show it as numbered steps. */
export function methodSteps(method?: string | null): string[] {
  return (method || '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}
