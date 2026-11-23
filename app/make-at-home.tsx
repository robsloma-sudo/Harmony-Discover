import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import { listMyVersions } from '../src/services/menuExplore';
import { ExploreSheet, SectionEyebrow } from '../src/explore/ExploreKit';
import { abvText } from '../src/explore/RecipeCard';
import { getCurrentDrink } from '../src/explore/currentDrink';
import { palette, space, type } from '../src/explore/exploreTheme';

const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);
type Home = { name: string; text: string; abv: string };

// Shows the server's own home_recipe text, from a saved version or the latest change.
export default function MakeAtHome() {
  const p = useLocalSearchParams<{ versionId?: string }>();
  const versionId = one(p.versionId);
  const [drink, setDrink] = useState<Home | null>(() => {
    const c = versionId ? null : getCurrentDrink();
    return c ? { name: c.name, text: c.changed.home_recipe, abv: abvText(c.changed.recipe) } : null;
  });
  useEffect(() => {
    if (!versionId) return;
    let live = true;
    listMyVersions().then(vs => { const v = vs.find(x => x.id === versionId); if (live && v) setDrink({ name: v.name, text: v.home_recipe, abv: abvText(v.recipe) }); })
      .catch(() => { const c = getCurrentDrink(); if (live && c) setDrink({ name: c.name, text: c.changed.home_recipe, abv: abvText(c.changed.recipe) }); });
    return () => { live = false; };
  }, [versionId]);
  const paragraphs = (drink?.text || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  return (
    <Screen hideTabs>
      <Text style={styles.back} onPress={() => router.back()}>‹  Back</Text>
      <SectionEyebrow>MAKE IT AT HOME</SectionEyebrow>
      {!drink ? <Text style={{ ...type.value, color: palette.ivory, marginTop: space.sm }}>No recipe to show.</Text> : <>
        <Text style={{ ...type.hero, color: palette.ivory, marginTop: space.sm }}>{drink.name}</Text>
        <ExploreSheet style={{ marginTop: space.lg, gap: space.md }}>
          {paragraphs.map((t, n) => <Text key={n} style={{ ...type.body, color: palette.ivory }}>{t}</Text>)}
          {!!drink.abv && <Text style={{ ...type.body, color: palette.brass }}>{drink.abv}</Text>}
        </ExploreSheet>
      </>}
    </Screen>
  );
}
