// Dev-only sample data (EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK === '1'). Clearly labelled; never real facts.
import type { CocktailRecipe, ExploreKind, Journey, MenuLineLink, ModifyAction } from './types';

export const MOCK_LABEL = 'Sample data (dev preview, not real facts).';
export const isMockMode = () => process.env.EXPO_PUBLIC_DISCOVER_EXPLORE_MOCK === '1';

export const MOCK_RECIPES: Record<string, CocktailRecipe> = {
  'cocktail:old-fashioned': {
    name: 'Old Fashioned', baseRefId: 'spirit:buffalo-trace',
    ingredients: [
      { name: 'Buffalo Trace bourbon', amount: 2, unit: 'oz', role: 'base', productRefId: 'spirit:buffalo-trace' },
      { name: 'Simple syrup', amount: 0.25, unit: 'oz', role: 'sweetener' },
      { name: 'Angostura bitters', amount: 2, unit: 'dashes', role: 'bitters' },
      { name: 'Orange peel', amount: 1, unit: 'strip', role: 'garnish' },
    ],
    method: 'Stir bourbon, syrup and bitters with ice. Strain over a large cube. Express the orange peel over the top.',
    glass: 'Rocks glass', garnish: 'Orange peel', changes: [],
  },
  'cocktail:negroni': {
    name: 'Negroni', baseRefId: 'spirit:tanqueray-gin',
    ingredients: [
      { name: 'Gin', amount: 1, unit: 'oz', role: 'base', productRefId: 'spirit:tanqueray-gin' },
      { name: 'Campari', amount: 1, unit: 'oz', role: 'modifier', productRefId: 'spirit:campari' },
      { name: 'Sweet vermouth', amount: 1, unit: 'oz', role: 'sweetener' },
      { name: 'Orange peel', amount: 1, unit: 'strip', role: 'garnish' },
    ],
    method: 'Stir everything with ice until cold. Strain over fresh ice. Garnish with orange peel.',
    glass: 'Rocks glass', garnish: 'Orange peel', changes: [],
  },
};

export function mockMenuLinks(items?: { id: string; name: string }[]): MenuLineLink[] {
  const list = items?.length ? items : [
    { id: 'mock-item-1', name: 'Old Fashioned with Buffalo Trace' }, { id: 'mock-item-2', name: 'Negroni' },
    { id: 'mock-item-3', name: 'Pinot Noir (glass)' }, { id: 'mock-item-4', name: 'Pilsner' }, { id: 'mock-item-5', name: 'Fried Pickles' },
  ];
  return list.map((it): MenuLineLink => {
    const n = it.name.toLowerCase();
    if (n.includes('old fashioned')) return { itemId: it.id, linked: true, cocktail: { refId: 'cocktail:old-fashioned', name: 'Old Fashioned' },
      components: [{ kind: 'spirit', refId: 'spirit:buffalo-trace', name: 'Buffalo Trace Bourbon', producer: 'Buffalo Trace Distillery', matchedText: 'Buffalo Trace' }] };
    if (n.includes('negroni')) return { itemId: it.id, linked: true, cocktail: { refId: 'cocktail:negroni', name: 'Negroni' },
      components: [
        { kind: 'spirit', refId: 'spirit:tanqueray-gin', name: 'London Dry Gin', producer: null, matchedText: 'gin' },
        { kind: 'spirit', refId: 'spirit:campari', name: 'Campari', producer: 'Gruppo Campari', matchedText: 'Campari' }] };
    if (n.includes('pinot')) return { itemId: it.id, linked: true, cocktail: null, components: [{ kind: 'wine', refId: 'wine:mock-pinot-noir', name: 'Pinot Noir', producer: null, matchedText: 'Pinot Noir' }] };
    if (n.includes('pilsner')) return { itemId: it.id, linked: true, cocktail: null, components: [{ kind: 'beer', refId: 'beer:mock-pilsner', name: 'Pilsner', producer: null, matchedText: 'Pilsner' }] };
    return { itemId: it.id, linked: false, cocktail: null, components: [] };
  });
}

const READY_AFTER = 2; // polls before a "building" journey becomes ready
const fetchCounts = new Map<string, number>();
export function resetMockJourneys() { fetchCounts.clear(); }

function mockJourneyBody(kind: ExploreKind, refId: string, name: string, status: Journey['status']): Journey {
  const base: Journey = { kind, refId, status, title: name, intro: `${MOCK_LABEL} A short story about ${name}.`, sections: [], updatedAt: null };
  if (status !== 'ready') return base;
  return { ...base, updatedAt: new Date().toISOString(), sections: [
    { heading: kind === 'cocktail' ? 'Origin' : 'Producer', body: `${MOCK_LABEL} Where ${name} comes from.` },
    { heading: kind === 'cocktail' ? 'Famous versions' : 'Region', body: `${MOCK_LABEL} Notable styles and places.` },
    { heading: 'History', body: `${MOCK_LABEL} How ${name} got its reputation.`, evidence: 'sample' },
  ] };
}

/** Ready immediately for old-fashioned and buffalo-trace; everything else (e.g. Campari) is 'building' for the first polls. */
export function mockJourney(kind: ExploreKind, refId: string, name: string): Journey {
  if (refId === 'cocktail:old-fashioned' || refId === 'spirit:buffalo-trace') return mockJourneyBody(kind, refId, name, 'ready');
  const key = `${kind}:${refId}`;
  const n = (fetchCounts.get(key) ?? 0) + 1;
  fetchCounts.set(key, n);
  return mockJourneyBody(kind, refId, name, n > READY_AFTER ? 'ready' : 'building');
}

const SWAPS = ['Rye whiskey', 'Scotch whisky', 'Reposado tequila', 'Dark rum', 'Cognac'];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function mockModify(recipe: CocktailRecipe, action: ModifyAction, option?: string | null): CocktailRecipe {
  const r = clone(recipe);
  const base = r.ingredients.find(i => i.role === 'base');
  const bump = (role: string, f: number) => { for (const i of r.ingredients) if (i.role === role && i.amount != null) i.amount = Math.round(i.amount * f * 100) / 100; };
  if (action === 'swap_base') {
    const choice = option || SWAPS.find(s => s.toLowerCase() !== (base?.name || '').toLowerCase()) || SWAPS[0];
    if (base) { r.changes.push(`Swapped ${base.name} for ${choice}`); base.name = choice; base.productRefId = null; r.baseRefId = null; }
  } else if (action === 'smokier') {
    r.ingredients.splice(Math.max(1, r.ingredients.findIndex(i => i.role === 'garnish')), 0, { name: 'Mezcal (float)', amount: 0.25, unit: 'oz', role: 'modifier' });
    r.changes.push('Added a mezcal float for smoke');
  } else if (action === 'lower_proof') {
    bump('base', 0.75);
    r.ingredients.splice(Math.max(1, r.ingredients.findIndex(i => i.role === 'garnish')), 0, { name: 'Soda water', amount: 1, unit: 'oz', role: 'lengthener' });
    r.changes.push('Less spirit, topped with soda for a lower proof');
  } else if (action === 'less_sweet') {
    bump('sweetener', 0.5);
    r.changes.push('Halved the sweetener');
  } else if (action === 'more_citrus') {
    if (r.ingredients.some(i => i.role === 'acid')) bump('acid', 1.5);
    else r.ingredients.splice(Math.max(1, r.ingredients.findIndex(i => i.role === 'garnish')), 0, { name: 'Fresh lemon juice', amount: 0.25, unit: 'oz', role: 'acid' });
    r.changes.push('More citrus');
  }
  return r;
}
