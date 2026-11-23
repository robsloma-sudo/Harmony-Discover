import { Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import { recordExploreEvent, type RecipeIngredient } from '../src/services/menuExplore';
import { ExploreSheet, LinkedChip, SectionEyebrow } from '../src/explore/ExploreKit';
import { amountText, methodSteps, parseRecipeParam } from '../src/explore/RecipeCard';
import { palette, space, type } from '../src/explore/exploreTheme';

const BOTTLE_ROLES = ['base', 'modifier', 'lengthener'];
const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);

export default function MakeAtHome() {
  const p = useLocalSearchParams<{ recipe?: string }>();
  const recipe = parseRecipeParam(one(p.recipe));
  if (!recipe) return <Screen hideTabs><Text style={styles.back} onPress={() => router.back()}>‹  Back</Text><Text style={{ ...type.value, color: palette.ivory }}>No recipe to show.</Text></Screen>;
  const bottles = recipe.ingredients.filter(i => i.role && BOTTLE_ROLES.includes(i.role));
  const also = recipe.ingredients.filter(i => !(i.role && BOTTLE_ROLES.includes(i.role)));
  const steps = methodSteps(recipe.method);
  const openBottle = (i: RecipeIngredient) => {
    if (!i.productRefId) return;
    const kind = i.productRefId.split(':')[0];
    recordExploreEvent({ type: 'line_tap', itemKind: kind === 'wine' || kind === 'beer' ? kind : 'spirit', refId: i.productRefId });
    router.push({ pathname: '/journey', params: { kind: kind === 'wine' || kind === 'beer' ? kind : 'spirit', ref: i.productRefId, name: i.name } } as never);
  };
  return (
    <Screen hideTabs>
      <Text style={styles.back} onPress={() => router.back()}>‹  Back</Text>
      <SectionEyebrow>MAKE IT AT HOME</SectionEyebrow>
      <Text style={{ ...type.hero, color: palette.ivory, marginTop: space.sm }}>{recipe.name}</Text>

      <ExploreSheet style={{ marginTop: space.lg, gap: space.sm }}>
        <SectionEyebrow>Bottles you need</SectionEyebrow>
        {bottles.length === 0 && <Text style={{ ...type.body, color: palette.muted }}>No bottles listed.</Text>}
        {bottles.map((i, n) => <View key={n} style={{ gap: 6, paddingVertical: 4 }}>
          <Text style={{ ...type.caption, color: palette.brass }}>{amountText(i)}</Text>
          <LinkedChip kind="spirit" label={i.name} linked={!!i.productRefId} onPress={() => openBottle(i)} />
        </View>)}
      </ExploreSheet>

      <ExploreSheet style={{ marginTop: space.md, gap: space.xs }}>
        <SectionEyebrow>Also needed</SectionEyebrow>
        {also.map((i, n) => <Text key={n} style={{ ...type.body, color: palette.ivory }}>• {amountText(i) ? amountText(i) + ' ' : ''}{i.name}</Text>)}
        <Text style={{ ...type.body, color: palette.ivory }}>• Ice</Text>
      </ExploreSheet>

      <ExploreSheet style={{ marginTop: space.md, gap: space.md }}>
        <SectionEyebrow>Steps</SectionEyebrow>
        {steps.map((s, n) => <View key={n} style={{ flexDirection: 'row', gap: space.md }}>
          <Text style={{ ...type.value, color: palette.brass, width: 28 }}>{n + 1}.</Text>
          <Text style={{ ...type.body, color: palette.ivory, flex: 1 }}>{s}</Text>
        </View>)}
        {!!recipe.glass && <Text style={{ ...type.body, color: palette.muted }}>Serve in a {recipe.glass.toLowerCase()}.</Text>}
      </ExploreSheet>
    </Screen>
  );
}
