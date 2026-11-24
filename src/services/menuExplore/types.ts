// Shared data shapes for Menu tap-to-explore. Screens import these; do not redefine.
// Field names follow the discover-explore server program (PR #128,
// supabase/functions/discover-explore/contract.ts + index.ts). Snake_case on purpose: same names as the wire.

export type ExploreKind = 'cocktail' | 'spirit' | 'wine' | 'beer' | 'other';

// ---- link_menu ----
export type LinkedItemRole = 'base' | 'modifier' | 'garnish' | 'pour' | 'other';
export type LinkedItem = { kind: ExploreKind; phg_product_id: string | null; name: string; role: LinkedItemRole };
export type MenuLineStatus = 'linked' | 'not_linked';
export type MenuLineLink = {
  line_id: string;                                  // observation_items.id (the scanned menu line)
  status: MenuLineStatus;
  kind: ExploreKind;
  cocktail: { id: string; name: string } | null;   // PHG cocktail_specs.id
  items: LinkedItem[];                              // each spirit / wine / beer in the line
  confidence: number;                               // 0..1
};
export type MenuLinksResult = { observation_id: string; lines: MenuLineLink[]; from_cache: boolean };

// ---- change_cocktail ----
export type ChangeType =
  | 'swap_base' | 'smokier' | 'lower_proof' | 'stronger' | 'sweeter' | 'drier'
  | 'more_citrus' | 'less_ice' | 'no_alcohol' | 'other';
export type CocktailChange = { type: ChangeType; value?: string | null };
export type RecipeLine = { ingredient: string; amount: string | null; phg_product_id: string | null };
export type Recipe = {
  name: string;
  base_cocktail_id: string | null;
  lines: RecipeLine[];
  method: string | null;
  glass: string | null;
  garnish: string | null;
  est_abv: number | null;
};
export type ChangedCocktail = {
  recipe: Recipe;
  bartender_card: string;   // text for the "show the bartender" screen
  home_recipe: string;      // make-at-home steps
  change_types: ChangeType[];
  ai_used: boolean;
};
// ---- get_recipe (look only: the unchanged recipe with amounts, no AI, no guest limit) ----
export type CocktailRecipe = { recipe: Recipe; bartender_card: string; home_recipe: string };

/** The five big buttons on the cocktail screen, and the server change each one sends. */
export type MakerButton = 'swap_base' | 'smokier' | 'lower_proof' | 'less_sweet' | 'more_citrus';
export const MAKER_BUTTON_CHANGE: Record<MakerButton, ChangeType> = {
  swap_base: 'swap_base', smokier: 'smokier', lower_proof: 'lower_proof', less_sweet: 'drier', more_citrus: 'more_citrus',
};

// ---- journey ----
// peek: true = look only (ready | building | none); never spends a guest's daily build. Used for pre-loading and polling.
// Server statuses: ready | built | building | none | limit. 'failed' is app-only (polling gave up / network error).
export type JourneyStatus = 'ready' | 'built' | 'building' | 'none' | 'limit' | 'failed' | 'still_building';
export type JourneySection = { heading: string; body: string; evidence?: string | null };
export type Journey = {
  kind: ExploreKind;
  ref: string;                // cocktail id or phg_product_id
  status: JourneyStatus;
  title: string;
  intro?: string | null;
  sections: JourneySection[];
  recipe?: Recipe | null;     // only when the server's journey carries one (cocktails)
  message?: string | null;    // friendly text for 'limit' (guest daily limit reached)
  built_now?: boolean;
};

// ---- save_version / list_versions / delete_version ----
export type MyVersion = {
  id: string;                     // phone id ("local-...") for versions made here; server id for versions pulled from the server
  server_id: string | null;       // discover_explore_versions.id once saved on the server
  name: string;
  recipe: Recipe;
  bartender_card: string;
  home_recipe: string;
  base_cocktail_id: string | null;
  change_types: ChangeType[];
  created_at: string;
};

// ---- tap ----
export type TapInput = { observation_id: string; line_id: string; item_kind: ExploreKind; item_ref: string };

export type JourneySource = 'memory' | 'storage' | 'network' | 'mock';
export type JourneyTimed = { journey: Journey; source: JourneySource; ms: number };
export type PollOptions = { intervalMs?: number; timeoutMs?: number };

/** Friendly text shown when a guest hits today's free limit (same words as the server). */
export const GUEST_LIMIT_MESSAGE = "You've reached today's free guest limit. Sign in (it's free) to keep going, or try again tomorrow.";
