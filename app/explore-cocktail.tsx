import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Screen, styles } from '../src/ui';
import {
  ExploreLimitError, changeCocktail, findMenuLine, getRecipe, listMyVersions, saveMyVersion, startingRecipe,
  type ChangedCocktail, type MakerButton, type MyVersion, type Recipe,
} from '../src/services/menuExplore';
import { BigActionButton, BuildingStoryState, ExploreSheet, FactRow, SectionEyebrow } from '../src/explore/ExploreKit';
import { IngredientList, abvText } from '../src/explore/RecipeCard';
import { setCurrentDrink } from '../src/explore/currentDrink';
import { palette, space, type } from '../src/explore/exploreTheme';

const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);
type Step = { recipe: Recipe; changed: ChangedCocktail | null };

export default function ExploreCocktail() {
  const p = useLocalSearchParams<{ cocktail?: string; name?: string; line_id?: string; observation_id?: string; versionId?: string }>();
  const cocktailParam = one(p.cocktail); const nameParam = one(p.name) || '';
  const lineId = one(p.line_id); const observationId = one(p.observation_id); const versionId = one(p.versionId);
  const [cocktailId, setCocktailId] = useState(cocktailParam || '');
  const [baseName, setBaseName] = useState(nameParam);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [changed, setChanged] = useState<ChangedCocktail | null>(null);   // last change from the server
  const [history, setHistory] = useState<Step[]>([]);                      // undo stack
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedVersion, setSavedVersion] = useState<MyVersion | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(false); setRecipe(null); setChanged(null); setHistory([]); setSavedVersion(null);
    (async () => {
      try {
        if (versionId) {
          const v = (await listMyVersions()).find(x => x.id === versionId);
          if (!v) throw new Error('missing');
          if (!live) return;
          const c: ChangedCocktail = { recipe: v.recipe, bartender_card: v.bartender_card, home_recipe: v.home_recipe, change_types: v.change_types, ai_used: false };
          setCocktailId(v.base_cocktail_id || v.recipe.base_cocktail_id || '');
          setBaseName(v.name); setRecipe(v.recipe); setChanged(c); setSavedVersion(v);
          setCurrentDrink({ name: v.name, baseName: v.name, changed: c });
        } else if (cocktailParam) {
          let r: Recipe;
          try {
            r = (await getRecipe(cocktailParam)).recipe;   // amounts at once
          } catch {
            const items = (lineId ? findMenuLine(lineId)?.line.items : null) ?? [];
            r = startingRecipe({ id: cocktailParam, name: nameParam || 'Cocktail' }, items);   // names only
          }
          if (!live) return;
          setCocktailId(cocktailParam); setBaseName(nameParam || r.name); setRecipe(r);
          setCurrentDrink(null);
        } else throw new Error('missing');
      } catch { if (live) setFailed(true); }
    })();
    return () => { live = false; };
  }, [cocktailParam, nameParam, lineId, versionId, attempt]);

  const errText = (e: unknown, fallback: string) => (e instanceof ExploreLimitError ? e.message : fallback);

  async function change(button: MakerButton) {
    if (!recipe || busy) return;
    setBusy(true); setError(''); setSavedVersion(null);
    try {
      const next = await changeCocktail({ cocktail_id: cocktailId, recipe, button, observation_id: observationId });
      setHistory(h => [...h, { recipe, changed }]);
      setRecipe(next.recipe); setChanged(next);
      setCurrentDrink({ name: next.recipe.name, baseName, changed: next });
    } catch (e) { setError(errText(e, 'That change did not work this time. Please try again.')); }
    finally { setBusy(false); }
  }
  function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory(h => h.slice(0, -1)); setRecipe(last.recipe); setChanged(last.changed); setSavedVersion(null); setError('');
    setCurrentDrink(last.changed ? { name: last.changed.recipe.name, baseName, changed: last.changed } : null);
  }
  async function save() {
    if (!changed) return;
    try { setSavedVersion(await saveMyVersion(changed, { observation_id: observationId })); setError(''); }
    catch (e) { setError(errText(e, 'Could not save this version. Please try again.')); }
  }
  const handOff = (pathname: string) => router.push({ pathname, params: savedVersion ? { versionId: savedVersion.id } : {} } as never);
  const goStory = () => router.push({ pathname: '/journey', params: { kind: 'cocktail', ref: cocktailId, name: baseName } } as never);
  const noAmounts = !!recipe && recipe.lines.every(l => !l.amount);
  const abv = abvText(recipe);

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
          <View style={{ marginTop: space.sm }}><IngredientList lines={recipe.lines} /></View>
          {noAmounts && <Text style={{ ...type.caption, color: palette.mutedDim, marginTop: space.sm }}>Tap a change to see the full recipe with amounts</Text>}
          <FactRow label="Method" value={recipe.method} />
          <FactRow label="Glass" value={recipe.glass} />
          <FactRow label="Garnish" value={recipe.garnish} />
          {!!abv && <Text style={{ ...type.body, color: palette.brass, marginTop: space.sm }}>{abv}</Text>}
        </ExploreSheet>

        <Text style={{ ...type.title, color: palette.ivory, marginTop: space.xl, marginBottom: space.md }}>Make it your way</Text>
        <View style={{ gap: space.md }}>
          <BigActionButton icon="swap-horizontal" label="Swap base spirit" disabled={busy} onPress={() => change('swap_base')} />
          <BigActionButton icon="flame-outline" label="Smokier" disabled={busy} onPress={() => change('smokier')} />
          <BigActionButton icon="arrow-down-circle-outline" label="Lower proof" disabled={busy} onPress={() => change('lower_proof')} />
          <BigActionButton icon="remove-circle-outline" label="Less sweet" disabled={busy} onPress={() => change('less_sweet')} />
          <BigActionButton icon="sunny-outline" label="More citrus" disabled={busy} onPress={() => change('more_citrus')} />
          <BigActionButton icon="arrow-undo" label="Undo last change" disabled={busy || history.length === 0} onPress={undo} />
        </View>
        {!!error && <Text style={{ ...type.body, color: '#E3B6A9', marginTop: space.md }}>{error}</Text>}

        <View style={{ gap: space.md, marginTop: space.xl }}>
          {!!cocktailId && <BigActionButton icon="book-outline" label="The story of this drink" onPress={goStory} />}
          <BigActionButton primary icon="bookmark-outline" label={savedVersion ? 'Saved as my version' : 'Save as my version'} disabled={!changed || !!savedVersion} onPress={save} />
          {savedVersion && <BigActionButton icon="list" label="See my versions" onPress={() => router.push('/my-versions' as never)} />}
          <BigActionButton primary icon="phone-portrait-outline" label="Show the bartender" disabled={!changed} onPress={() => handOff('/show-bartender')} />
          <BigActionButton icon="home-outline" label="Make it at home" disabled={!changed} onPress={() => handOff('/make-at-home')} />
          {!changed && <Text style={{ ...type.caption, color: palette.mutedDim }}>Make a change above to save it, show it to the bartender, or make it at home.</Text>}
        </View>
      </>}
    </Screen>
  );
}
