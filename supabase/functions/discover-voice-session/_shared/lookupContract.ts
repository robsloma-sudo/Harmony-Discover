// P-20261125-0219 part 1 · Marty's read-only look-ups · shared contract between
// lookups.ts (the look-up layer, Harmony linking) and index.ts / realtimeSession.ts (the voice program, Platform & privacy).
// Every look-up only READS. Nothing about the guest is sent to PHG main: PHG gets the bridge token plus a drink name or id only.

// PHG main command names. The two marked PENDING do not exist yet (asked of the Cocktails & pairing team);
// until they do, those look-ups answer "unavailable" and Marty says he is not sure. Renaming is a one-line change here.
export const PHG_LOOKUP_COMMANDS = {
  cocktailFind: "discover_cocktail_find",        // PENDING (cocktails-pairing): (p_token, p_name, p_limit) -> [{id, name, match: "exact"|"close"}]
  recipe: "discover_cocktail_recipe",            // live: (p_token, p_cocktail_id) -> {recipe, bartender_card, home_recipe}
  journey: "discover_journey_fetch_or_build",    // live: always called with p_build = false (fetch never queues, never writes)
  pairing: "discover_pairing_ideas",             // PENDING (cocktails-pairing): (p_token, p_item_kind, p_item_ref, p_name) -> {ideas: [{pairing, why}]}
} as const;

export const LOOKUP_TOOL_NAMES = [
  "lookup_cocktail", "lookup_bottle", "lookup_brand", "lookup_journey", "pairing_ideas", "my_saved_drinks",
] as const;
export type LookupToolName = typeof LOOKUP_TOOL_NAMES[number];

export type ItemKind = "cocktail" | "spirit" | "wine" | "beer";

// Arguments after validation (strings trimmed, control chars removed, max 120 chars).
export type LookupArgs =
  | { tool: "lookup_cocktail"; name: string }
  | { tool: "lookup_bottle"; name: string; brand: string | null }
  | { tool: "lookup_brand"; brand: string }
  | { tool: "lookup_journey"; name: string; kind: ItemKind }
  | { tool: "pairing_ideas"; name: string; kind: ItemKind }
  | { tool: "my_saved_drinks" };

// What goes back to Marty (the app passes it on unchanged as the tool output).
//  found       : Harmony (or the guest's own saved) data exists; answer from it.
//  not_sure    : nothing reliable found; Marty must say he is not sure and must not make it up.
//  unavailable : the look-up could not run right now (PHG slow/down or command not ready); same rule as not_sure.
export interface LookupResult {
  status: "found" | "not_sure" | "unavailable";
  source: "harmony" | "your_saved" | null;
  data: Record<string, unknown> | null;
  say: string; // one short plain instruction to Marty about how to use this result
}

// Size cap on what is returned to the model (keeps cost per Marty minute small).
export const MAX_RESULT_CHARS = 3000;
