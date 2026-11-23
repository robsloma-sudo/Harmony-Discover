// Shared data shapes for Menu tap-to-explore. Screens import these; do not redefine.
export type ExploreKind = 'cocktail' | 'spirit' | 'wine' | 'beer';
export type LinkedComponent = { kind: Exclude<ExploreKind, 'cocktail'>; refId: string; name: string; producer?: string | null; matchedText: string };
export type MenuLineLink = { itemId: string; linked: boolean; cocktail?: { refId: string; name: string } | null; components: LinkedComponent[] };
export type JourneySection = { heading: string; body: string; evidence?: string | null };
export type JourneyStatus = 'ready' | 'building' | 'failed';
export type Journey = { kind: ExploreKind; refId: string; status: JourneyStatus; title: string; intro?: string | null; sections: JourneySection[]; updatedAt?: string | null };
export type RecipeRole = 'base' | 'modifier' | 'sweetener' | 'acid' | 'bitters' | 'lengthener' | 'garnish' | 'other';
export type RecipeIngredient = { name: string; amount?: number | null; unit?: string | null; role?: RecipeRole; productRefId?: string | null };
export type CocktailRecipe = { name: string; baseRefId?: string | null; ingredients: RecipeIngredient[]; method?: string | null; glass?: string | null; garnish?: string | null; changes: string[] };
export type ModifyAction = 'swap_base' | 'smokier' | 'lower_proof' | 'less_sweet' | 'more_citrus';
export type MyVersion = { id: string; name: string; recipe: CocktailRecipe; originalName: string; createdAt: string };

export type JourneySource = 'memory' | 'storage' | 'network' | 'mock';
export type JourneyTimed = { journey: Journey; source: JourneySource; ms: number };
export type PollOptions = { intervalMs?: number; timeoutMs?: number };
// Anonymous events: only these fields are ever sent.
export type ExploreEventInput = { type: string; itemKind: ExploreKind | 'menu_item'; refId?: string | null; action?: string | null };
