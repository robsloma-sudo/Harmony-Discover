import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { methodSteps, amountText, parseRecipeParam } from '../src/explore/RecipeCard';

const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);

// Pure black and white, huge type, so it can be read across a bar. No venue anywhere.
export default function ShowBartender() {
  const p = useLocalSearchParams<{ recipe?: string; original?: string }>();
  const recipe = parseRecipeParam(one(p.recipe)); const original = one(p.original);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 56, paddingBottom: 40 }}>
        {!recipe ? <Text style={{ color: '#fff', fontSize: 32, fontWeight: '900' }}>No recipe to show.</Text> : <>
          <Text style={{ color: '#fff', fontSize: 48, fontWeight: '900', lineHeight: 54 }}>{recipe.name}</Text>
          {!!original && <Text style={{ color: '#FFD98A', fontSize: 24, fontWeight: '700', marginTop: 8 }}>Based on {original}</Text>}
          <View style={{ marginTop: 28, gap: 10 }}>
            {recipe.ingredients.map((i, n) => <Text key={n} style={{ color: '#fff', fontSize: 32, fontWeight: '800', lineHeight: 40 }}>
              <Text style={{ color: '#FFD98A' }}>{amountText(i)}</Text>{amountText(i) ? '  ' : ''}{i.name}
            </Text>)}
          </View>
          {!!recipe.method && <>
            <Text style={{ color: '#FFD98A', fontSize: 20, fontWeight: '900', letterSpacing: 2, marginTop: 32 }}>METHOD</Text>
            {methodSteps(recipe.method).map((s, n) => <Text key={n} style={{ color: '#fff', fontSize: 28, fontWeight: '700', lineHeight: 36, marginTop: 8 }}>{n + 1}. {s}</Text>)}
          </>}
          {!!recipe.glass && <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 28 }}><Text style={{ color: '#FFD98A' }}>Glass  </Text>{recipe.glass}</Text>}
          {!!recipe.garnish && <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800', marginTop: 12 }}><Text style={{ color: '#FFD98A' }}>Garnish  </Text>{recipe.garnish}</Text>}
        </>}
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close}
        style={{ margin: 16, marginBottom: 28, minHeight: 72, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#000', fontSize: 28, fontWeight: '900' }}>Close</Text>
      </Pressable>
    </View>
  );
}
