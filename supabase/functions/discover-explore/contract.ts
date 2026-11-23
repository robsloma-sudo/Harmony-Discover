// P-20261123-0711 part 3 · Tap-to-explore from a scanned menu · shared contract between
// index.ts (the server program, Platform & privacy) and phg.ts (calls to PHG main, Harmony linking).
// PHG main command names are DRAFTS until the Brands (part 1) and Cocktails (part 2) teams post theirs;
// they live ONLY in PHG_COMMANDS below so renaming is a one-line change.

export const PHG_COMMANDS = {
  linkLines: "discover_menu_lines_link",        // part 1 (Brands): link menu drink lines to cocktails / products
  changeCocktail: "discover_cocktail_change",   // part 2 (Cocktails): apply guest changes to a cocktail recipe
  journey: "discover_journey_fetch_or_build",   // part 2 (Cocktails): fetch a Journey, or build + save it once
  counts: "discover_explore_counts_submit",     // part 2 (Cocktails): landing table for combined counts
} as const;

export type ItemKind = "cocktail" | "spirit" | "wine" | "beer" | "other";

export interface MenuLineIn {
  line_id: string;            // observation_items.id
  section: string | null;
  name: string;
  description: string | null;
  price_text: string | null;
  beverage_category: string | null;
  listed_ingredients: string[];
}

export interface LinkedItem {
  kind: ItemKind;
  phg_product_id: string | null;   // Harmony product: public.products.id on PHG main (spirit/wine/beer)
  name: string;
  role: "base" | "modifier" | "garnish" | "pour" | "other";
}

export interface LinkedLine {
  line_id: string;
  status: "linked" | "not_linked";
  kind: ItemKind;
  cocktail: { id: string; name: string } | null;  // Harmony cocktail: public.cocktail_specs.id on PHG main
  items: LinkedItem[];                             // each spirit, wine or beer in the line (or the line itself)
  confidence: number;                              // 0..1
}

export type ChangeType =
  | "swap_base" | "smokier" | "lower_proof" | "stronger" | "sweeter" | "drier"
  | "more_citrus" | "less_ice" | "no_alcohol" | "other";

export interface CocktailChange { type: ChangeType; value?: string | null }

export interface RecipeLine { ingredient: string; amount: string | null; phg_product_id: string | null }
export interface Recipe {
  name: string;
  base_cocktail_id: string | null;
  lines: RecipeLine[];
  method: string | null;
  glass: string | null;
  garnish: string | null;
  est_abv: number | null;
}

export interface ChangedCocktail {
  recipe: Recipe;
  bartender_card: string;   // short text for the "show the bartender" screen
  home_recipe: string;      // make-at-home steps
  change_types: ChangeType[];
  ai_used: boolean;         // true when PHG had to call an AI model (counts toward guest limits)
}

export interface JourneyResult {
  status: "ready" | "built" | "building" | "none";
  built_now: boolean;       // true only on the call that paid for a new build
  journey: Record<string, unknown> | null;
}

// One combined row: no person, device, session or guest IDs ever.
export interface CountRow {
  venue_id: string | null;     // Discover venue (null = unknown venue)
  week_start: string;          // Monday, yyyy-mm-dd (UTC)
  item_kind: ItemKind;
  item_ref: string;            // cocktail_specs.id (cocktails) or products.id (spirit/wine/beer); a changed cocktail counts under its base spec id
  event: "tap" | "journey_open" | "change" | "save_my_version";
  change_type: ChangeType | null;
  count: number;
  guests: number;              // distinct guests behind the count (only rows at/above the cut-off are sent)
}

export interface PhgConfig { url: string; anonKey: string; token: string }
