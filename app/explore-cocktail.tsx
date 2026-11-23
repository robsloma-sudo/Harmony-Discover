import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import {
  getCocktailRecipe, listMyVersions, modifyCocktail, recordExploreEvent, saveMyVersion,
  type CocktailRecipe, type ModifyAction,
} from '../src/services/menuExplore';
import { BigActionButton, BuildingStoryState, ExploreSheet, FactRow, SectionEyebrow } from '../src/explore/ExploreKit';
import { IngredientList } from '../src/explore/RecipeCard';
import { palette, space, type } from '../src/explore/exploreTheme';

const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);
const SWAP_OPTIONS = ['Bourbon', 'Rye whiskey', 'Rum', 'Tequila', 'Mezcal', 'Gin', 'Brandy'];

export default function ExploreCocktail() {
  const p = useLocalSearchParams<{ ref?: string; name?: string; item?: string; version?: string }>();
  const refId = one(p.ref); const versionId = one(p.version); const nameParam = one(p.name);
  const [recipe, setRecipe] = useState<CocktailRecipe | null>(null);
  const [original, setOriginal] = useState(nameParam || '');
  const [history, setHistory] = useState<CocktailRecipe[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [swapOpen, setSwapOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(false); setRecipe(null);
    (async () => {
      try {
        if (versionId) {
          const v = (await listMyVersions()).find(x => x.id === versionId);
          if (!v) throw new Error('missing');
          if (live) { setRecipe(v.recipe); setOriginal(v.originalName); }
        } else if (refId) {
          const r = await getCocktailRecipe(refId);
          if (live) { setRecipe(r); setOriginal(r.name); }
        } else throw new Error('missing');
      } catch { if (live) setFailed(true); }
    })();
    return () => { live = false; };
  }, [refId, versionId, attempt]);

  async function change(action: ModifyAction, option?: string) {
    if (!recipe || busy) return;
    setBusy(true); setError(''); setSwapOpen(false); setSaved(false);
    try {
      const next = await modifyCocktail(recipe, action, option);
      setHistory(h => [...h, recipe]); setRecipe(next);
      recordExploreEvent({ type: 'modify', itemKind: 'cocktail', refId: refId || recipe.baseRefId, action });
    } catch { setError('That change did not work this time. Please try again.'); }
    finally { setBusy(false); }
  }
  function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory(h => h.slice(0, -1)); setRecipe(last); setSaved(false);
    recordExploreEvent({ type: 'modify', itemKind: 'cocktail', refId, action: 'undo' });
  }
  async function save() {
    if (!recipe) return;
    try {
      await saveMyVersion(recipe, original || recipe.name);
      setSaved(true);
      recordExploreEvent({ type: 'modify', itemKind: 'cocktail', refId, action: 'save' });
    } catch { setError('Could not save this version. Please try again.'); }
  }
  const recipeParams = () => ({ recipe: JSON.stringify(recipe), original });
  const goStory = () => router.push({ pathname: '/journey', params: { kind: 'cocktail', ref: refId || 'cocktail:' + (recipe?.name || '').toLowerCase().replace(/\s+/g, '-'), name: original || recipe?.name || '' } } as never);

  return (
    <Screen hideTabs>
      <Text style={styles.back} onPress={() => router.back()}>‹  Back</Text>
      <SectionEyebrow>COCKTAIL MAKER</SectionEyebrow>
      <Text style={{ ...type.hero, color: palette.ivory, marginTop: space.sm }}>{recipe?.name || nameParam || 'Cocktail'}</Text>
      {!recipe && !failed && <BuildingStoryState title="Getting the recipe…" sub="One moment." />}
      {failed && <ExploreSheet style={{ marginTop: space.lg, gap: space.md }}>
        <Text style={{ ...type.value, color: palette.ivory }}>We do not have a recipe for this drink yet.</Text>
        <BigActionButton primary icon="refresh" label="Try again" onPress={() => setAttempt(n => n + 1)} />
      </ExploreSheet>}
      {recipe && <>
        <ExploreSheet style={{ marginTop: space.lg }}>
          <SectionEyebrow>Recipe</SectionEyebrow>
          <View style={{ marginTop: space.sm }}><IngredientList ingredients={recipe.ingredients} /></View>
          <FactRow label="Method" value={recipe.method} />
          <FactRow label="Glass" value={recipe.glass} />
          <FactRow label="Garnish" value={recipe.garnish} />
        </ExploreSheet>

        {recipe.changes.length > 0 && <ExploreSheet style={{ marginTop: space.md }}>
          <SectionEyebrow>What changed</SectionEyebrow>
          {recipe.changes.map((c, i) => <Text key={i} style={{ ...type.body, color: palette.ivory, marginTop: space.sm }}>• {c}</Text>)}
        </ExploreSheet>}

        <Text style={{ ...type.title, color: palette.ivory, marginTop: space.xl, marginBottom: space.md }}>Make it your way</Text>
        <View style={{ gap: space.md }}>
          <BigActionButton icon="swap-horizontal" label="Swap base spirit" disabled={busy} onPress={() => setSwapOpen(o => !o)} />
          {swapOpen && <ExploreSheet style={{ gap: space.sm }}>
            <SectionEyebrow>Pick the new base</SectionEyebrow>
            {SWAP_OPTIONS.map(o => <BigActionButton key={o} label={o} onPress={() => change('swap_base', o)} />)}
          </ExploreSheet>}
          <BigActionButton icon="flame-outline" label="Smokier" disabled={busy} onPress={() => change('smokier')} />
          <BigActionButton icon="arrow-down-circle-outline" label="Lower proof" disabled={busy} onPress={() => change('lower_proof')} />
          <BigActionButton icon="remove-circle-outline" label="Less sweet" disabled={busy} onPress={() => change('less_sweet')} />
          <BigActionButton icon="sunny-outline" label="More citrus" disabled={busy} onPress={() => change('more_citrus')} />
          <BigActionButton icon="arrow-undo" label="Undo last change" disabled={busy || history.length === 0} onPress={undo} />
        </View>
        {!!error && <Text style={{ ...type.body, color: '#E3B6A9', marginTop: space.md }}>{error}</Text>}

        <View style={{ gap: space.md, marginTop: space.xl }}>
          <BigActionButton icon="book-outline" label="The story of this drink" onPress={goStory} />
          <BigActionButton primary icon="bookmark-outline" label={saved ? 'Saved as my version' : 'Save as my version'} disabled={saved} onPress={save} />
          {saved && <BigActionButton icon="list" label="See my versions" onPress={() => router.push('/my-versions' as never)} />}
          <BigActionButton primary icon="phone-portrait-outline" label="Show the bartender" onPress={() => router.push({ pathname: '/show-bartender', params: recipeParams() } as never)} />
          <BigActionButton icon="home-outline" label="Make it at home" onPress={() => router.push({ pathname: '/make-at-home', params: recipeParams() } as never)} />
        </View>
      </>}
    </Screen>
  );
}
