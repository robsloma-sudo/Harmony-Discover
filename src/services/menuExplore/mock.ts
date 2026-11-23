// Dev-only sample data (EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK === '1'). Clearly labelled; never real facts.
import type { ChangedCocktail, ChangeType, CocktailChange, ExploreKind, Journey, MenuLineLink, Recipe } from './types';

export const MOCK_LABEL = 'Sample data (dev preview, not real facts).';
export const isMockMode = () => process.env.EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK === '1';

export const MOCK_COCKTAIL_OLD_FASHIONED = 'mock-cocktail-old-fashioned';
export const MOCK_COCKTAIL_NEGRONI = 'mock-cocktail-negroni';
export const MOCK_PRODUCT_BUFFALO_TRACE = 'mock-product-buffalo-trace';

export const MOCK_RECIPES: Record<string, Recipe> = {
  [MOCK_COCKTAIL_OLD_FASHIONED]: {
    name: 'Old Fashioned', base_cocktail_id: MOCK_COCKTAIL_OLD_FASHIONED,
    lines: [
      { ingredient: 'Buffalo Trace bourbon', amount: '2 oz', phg_product_id: MOCK_PRODUCT_BUFFALO_TRACE },
      { ingredient: 'Simple syrup', amount: '1/4 oz', phg_product_id: null },
      { ingredient: 'Angostura bitters', amount: '2 dashes', phg_product_id: null },
    ],
    method: 'Stir with ice. Strain over a large cube.', glass: 'Rocks glass', garnish: 'Orange peel', est_abv: 0.3,
  },
  [MOCK_COCKTAIL_NEGRONI]: {
    name: 'Negroni', base_cocktail_id: MOCK_COCKTAIL_NEGRONI,
    lines: [
      { ingredient: 'Gin', amount: '1 oz', phg_product_id: 'mock-product-gin' },
      { ingredient: 'Campari', amount: '1 oz', phg_product_id: 'mock-product-campari' },
      { ingredient: 'Sweet vermouth', amount: '1 oz', phg_product_id: null },
    ],
    method: 'Stir with ice. Strain over fresh ice.', glass: 'Rocks glass', garnish: 'Orange peel', est_abv: 0.25,
  },
};

export function mockMenuLinks(items?: { id: string; name: string }[]): MenuLineLink[] {
  const list = items?.length ? items : [
    { id: 'mock-item-1', name: 'Old Fashioned with Buffalo Trace' }, { id: 'mock-item-2', name: 'Negroni' },
    { id: 'mock-item-3', name: 'Pinot Noir (glass)' }, { id: 'mock-item-4', name: 'Pilsner' }, { id: 'mock-item-5', name: 'Fried Pickles' },
  ];
  return list.map((it): MenuLineLink => {
    const n = it.name.toLowerCase();
    if (n.includes('old fashioned')) return { line_id: it.id, status: 'linked', kind: 'cocktail', confidence: 0.9,
      cocktail: { id: MOCK_COCKTAIL_OLD_FASHIONED, name: 'Old Fashioned' },
      items: [{ kind: 'spirit', phg_product_id: MOCK_PRODUCT_BUFFALO_TRACE, name: 'Buffalo Trace Bourbon', role: 'base' }] };
    if (n.includes('negroni')) return { line_id: it.id, status: 'linked', kind: 'cocktail', confidence: 0.9,
      cocktail: { id: MOCK_COCKTAIL_NEGRONI, name: 'Negroni' },
      items: [
        { kind: 'spirit', phg_product_id: 'mock-product-gin', name: 'London Dry Gin', role: 'base' },
        { kind: 'spirit', phg_product_id: 'mock-product-campari', name: 'Campari', role: 'modifier' }] };
    if (n.includes('pinot')) return { line_id: it.id, status: 'linked', kind: 'wine', confidence: 0.8, cocktail: null,
      items: [{ kind: 'wine', phg_product_id: 'mock-product-pinot-noir', name: 'Pinot Noir', role: 'pour' }] };
    if (n.includes('pilsner')) return { line_id: it.id, status: 'linked', kind: 'beer', confidence: 0.8, cocktail: null,
      items: [{ kind: 'beer', phg_product_id: 'mock-product-pilsner', name: 'Pilsner', role: 'pour' }] };
    return { line_id: it.id, status: 'not_linked', kind: 'other', confidence: 0, cocktail: null, items: [] };
  });
}

const READY_AFTER = 2; // polls before a "building" journey becomes ready
const fetchCounts = new Map<string, number>();
export function resetMockJourneys() { fetchCounts.clear(); }

function mockJourneyBody(kind: ExploreKind, ref: string, name: string, status: Journey['status']): Journey {
  const base: Journey = { kind, ref, status, title: name, intro: `${MOCK_LABEL} A short story about ${name}.`, sections: [] };
  if (status !== 'ready') return base;
  return { ...base, sections: [
    { heading: kind === 'cocktail' ? 'Origin' : 'Producer', body: `${MOCK_LABEL} Where ${name} comes from.` },
    { heading: kind === 'cocktail' ? 'Famous versions' : 'Region', body: `${MOCK_LABEL} Notable styles and places.` },
    { heading: 'History', body: `${MOCK_LABEL} How ${name} got its reputation.`, evidence: 'sample' },
  ] };
}

/** Ready immediately for old-fashioned and buffalo-trace; everything else is 'building' for the first polls. */
export function mockJourney(kind: ExploreKind, ref: string, name: string): Journey {
  if (ref === MOCK_COCKTAIL_OLD_FASHIONED || ref === MOCK_PRODUCT_BUFFALO_TRACE) return mockJourneyBody(kind, ref, name, 'ready');
  const key = `${kind}:${ref}`;
  const n = (fetchCounts.get(key) ?? 0) + 1;
  fetchCounts.set(key, n);
  return mockJourneyBody(kind, ref, name, n > READY_AFTER ? 'ready' : 'building');
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function mockChangeCocktail(recipe: Recipe, changes: CocktailChange[]): ChangedCocktail {
  const r = clone(recipe);
  const notes: string[] = [];
  const insertAt = () => r.lines.length;
  for (const c of changes) {
    if (c.type === 'swap_base' && r.lines[0]) { notes.push(`${r.lines[0].ingredient} swapped for rye whiskey`); r.lines[0] = { ingredient: 'Rye whiskey', amount: r.lines[0].amount, phg_product_id: null }; }
    else if (c.type === 'smokier') { r.lines.splice(insertAt(), 0, { ingredient: 'Mezcal (float)', amount: '1/4 oz', phg_product_id: null }); notes.push('a mezcal float for smoke'); }
    else if (c.type === 'lower_proof') { r.lines.splice(insertAt(), 0, { ingredient: 'Soda water', amount: '1 oz', phg_product_id: null }); notes.push('topped with soda for a lower proof'); if (r.est_abv != null) r.est_abv = Math.round(r.est_abv * 75) / 100; }
    else if (c.type === 'drier') notes.push('half the sweetener');
    else if (c.type === 'more_citrus') { r.lines.splice(insertAt(), 0, { ingredient: 'Fresh lemon juice', amount: '1/4 oz', phg_product_id: null }); notes.push('more citrus'); }
    else notes.push(c.type.replace(/_/g, ' '));
  }
  const summary = notes.join(', ') || 'no changes';
  const ingredients = r.lines.map(l => `${l.amount ? l.amount + ' ' : ''}${l.ingredient}`).join('\n');
  return {
    recipe: r,
    bartender_card: `${MOCK_LABEL}\n${r.name}, please: ${summary}.\n${ingredients}`,
    home_recipe: `${MOCK_LABEL}\n${r.name} (${summary})\n${ingredients}\n${r.method ?? ''}`.trim(),
    change_types: changes.map(c => c.type) as ChangeType[],
    ai_used: false,
  };
}
