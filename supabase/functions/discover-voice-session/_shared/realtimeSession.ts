import { martyBostonInstructions, martyBostonComedyCraft } from "./martySullivanBoston.ts";
import { martyDeliveryInstructions, formatSessionFlavor, pickSessionFlavor, type Pick } from "./martyDelivery.ts";
import { formatScreenContextInstructions, type ScreenContext } from "./screenContext.ts";

export const MODEL = "gpt-realtime-2.1";
export const DEFAULT_VOICE = "cedar";
export const ALLOWED_VOICES = ["cedar", "ash", "marin", "verse", "ballad", "echo", "sage"] as const;
export const VOICE_SPEED = 0.95;
export const MAX_OUTPUT_TOKENS = 500;
export type VoiceMode = "push_to_talk" | "hands_free";

export const DISCOVER_NAVIGATION_TOOLS = [
  { type: "function", name: "navigate_discover", description: "Navigate the Harmony Discover app to one of its existing screens. Use when the user asks to go to, open, show, or take them to a screen.", parameters: { type: "object", additionalProperties: false, properties: { screen: { type: "string", enum: ["discover", "nearby", "library", "taste", "settings"] }, radius_miles: { type: "integer", enum: [1, 5, 10, 15, 20] }, category: { type: "string", enum: ["all", "bar", "cocktail_bar", "restaurant", "brewery", "winery", "distillery"] }, search: { type: "string" } }, required: ["screen"] } },
  { type: "function", name: "control_nearby_atlas", description: "Change the Nearby Atlas view. Use only for a clear request to change radius, venue category, search phrase, or recenter the user's location.", parameters: { type: "object", additionalProperties: false, properties: { action: { type: "string", enum: ["set_radius", "set_category", "search", "recenter"] }, radius_miles: { type: "integer", enum: [1, 5, 10, 15, 20] }, category: { type: "string", enum: ["all", "bar", "cocktail_bar", "restaurant", "brewery", "winery", "distillery"] }, search: { type: "string" } }, required: ["action"] } }
] as const;

export const DISCOVER_NAVIGATION_INSTRUCTIONS = `
HARMONY DISCOVER NAVIGATION — DERIVED FROM HARMONY'S SEMANTIC INTERPRETER AND ATLAS INTENT PLANNER
You are Marty inside Harmony Discover. Understand natural spoken language, not just exact button labels.
When the user clearly asks to navigate or change the Nearby Atlas, call the matching function. Do not merely describe the action.
Supported screens: Discover camera/home, Nearby world Atlas, Library/collection/favorites, My taste, Settings.
Examples: "take me nearby", "open the atlas", "show bars around me" -> navigate_discover screen nearby; "go to my saved drinks" -> library; "back to the camera" -> discover.
Nearby radius is exactly one of 1, 5, 10, 15, 20 miles. "Expand the search to ten miles" -> set_radius 10. "Show breweries" -> set_category brewery. "Only cocktail bars" -> set_category cocktail_bar. "Show restaurants" -> restaurant. "Search for [phrase]" -> search. "Find me again", "recenter", "use my location" -> recenter.
A combined request such as "take me nearby and show breweries within ten miles" should use navigate_discover with screen nearby, radius_miles 10, category brewery.
Preserve the current conversational context for follow-ups such as "make it five", "only wineries", "search for that place", "go back", and "recenter me".
Never invent a screen, venue, result, map control, or capability. Only call these two functions for the actions they explicitly support. If the user asks for something not supported, explain the limitation and do not fake an action.
Ask one short clarifying question if the requested screen or filter is genuinely ambiguous.
Do not change account data, submit venue edits, or make purchases through navigation tools. A tool call is an instruction to the app, not permission for unrelated actions.
`;

export function resolveVoice(voiceEnv: string | undefined | null): string {
  const v = (voiceEnv ?? "").trim().toLowerCase();
  return (ALLOWED_VOICES as readonly string[]).includes(v) ? v : DEFAULT_VOICE;
}

export function resolveMode(requested: VoiceMode, handsFreeEnv: string | undefined | null): VoiceMode {
  return requested === "hands_free" && handsFreeEnv === "on" ? "hands_free" : "push_to_talk";
}

export interface BuildRealtimeSessionArgs {
  voiceEnv?: string | null;
  handsFreeEnv?: string | null;
  mode: VoiceMode;
  screenContext?: ScreenContext | null;
  memoryContext?: string;
  pick?: Pick;
}

export function buildRealtimeSession(args: BuildRealtimeSessionArgs) {
  const voice = resolveVoice(args.voiceEnv);
  const mode = resolveMode(args.mode, args.handsFreeEnv);
  const flavor = pickSessionFlavor(args.pick);
  const instructions = martyBostonInstructions + martyBostonComedyCraft +
    martyDeliveryInstructions + formatSessionFlavor(flavor) +
    DISCOVER_NAVIGATION_INSTRUCTIONS +
    formatScreenContextInstructions(args.screenContext ?? null) +
    (args.memoryContext ?? "");
  const turnDetection = mode === "hands_free"
    ? { type: "semantic_vad", eagerness: "high", create_response: true, interrupt_response: true }
    : null;
  return {
    voice,
    mode,
    flavor,
    session: {
      type: "realtime",
      model: MODEL,
      instructions,
      tools: DISCOVER_NAVIGATION_TOOLS,
      output_modalities: ["audio"],
      max_output_tokens: MAX_OUTPUT_TOKENS,
      audio: {
        input: {
          transcription: { model: "gpt-live-transcribe" },
          noise_reduction: { type: "near_field" },
          turn_detection: turnDetection,
        },
        output: { voice, speed: VOICE_SPEED },
      },
    },
  };
}
