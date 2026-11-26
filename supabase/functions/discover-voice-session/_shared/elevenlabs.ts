// Live Marty on Rob's own ElevenLabs voice "Marty" (P-20261126-0102 part 1). Pure logic, fetch injected.
// Grew out of the listening test's ElevenLabs option (#154, #157), which this replaces.
// Official ElevenLabs API only (api.elevenlabs.io), server key from the Edge Functions secret ELEVENLABS_API_KEY.
// The key never leaves the server; the app only gets a one-conversation token (WebRTC) or a short-lived signed
// address (WebSocket, which also carries sound chunks and letter timing for the face's mouth).
//
// Flow on each ElevenLabs start (all server side):
//  1. Voice: always Rob's own voice "Marty" (MARTY_VOICE_ID), unless ELEVENLABS_VOICE_ID overrides it. Read-only
//     check that it exists; the server NEVER designs, saves or changes a voice. Missing = step voice_not_found.
//  2. Agent: ELEVENLABS_AGENT_ID if set, else our ONE agent found by exact name (search, then paged list, oldest
//     wins), created only if none exists. Sign-in requirement always ON (platform_settings.auth.enable_auth).
//  3. The agent holds ONLY the shared Marty script (identical for every guest: Boston script, comedy craft,
//     character book, delivery/mood/pet-peeve rules, navigation and look-up rules). Per-guest parts (session
//     flavor, screen context, saved memories) are NEVER written to the shared agent, so one guest's memories can
//     never reach another guest; they go to the app as the dynamic variable marty_session, which the agent's
//     prompt reads as {{marty_session}}.
//  4. A one-conversation token (webrtc) or signed address (websocket) for that agent.
// Confirmed from ElevenLabs docs (read 26 Nov 2026): GET /v1/convai/conversation/token?agent_id= -> { token },
// GET /v1/convai/conversation/get-signed-url?agent_id=, xi-api-key header, client startSession({ conversationToken |
// signedUrl, dynamicVariables, clientTools }), {{variable}} dynamic variables in the system prompt.
// UNCONFIRMED (pages refused or not re-read): GET /v1/voices/{id}, agent create/update/list paths and body shape,
// inline client tools (conversation_config.agent.prompt.tools, type "client"), dynamic variable placeholders, and the
// signed_url field name. Safety net: if ElevenLabs refuses the full agent settings (400/422), the server retries
// once with the plain settings (script + voice + sign-in, no tools); clientTools in the answer tells the app which
// tools the agent really has. Any other ElevenLabs failure falls back to today's OpenAI voice (see index.ts).

import {
  DISCOVER_NAVIGATION_INSTRUCTIONS, DISCOVER_NAVIGATION_TOOLS, MARTY_LOOKUP_INSTRUCTIONS, MARTY_LOOKUP_TOOLS,
  resolveMode, type VoiceMode,
} from "./realtimeSession.ts";
import { martyBostonComedyCraft, martyBostonInstructions, MARTY_NO_HOST_MANNERS } from "./martySullivanBoston.ts";
import { formatSessionFlavor, martyDeliveryInstructions, pickSessionFlavor, type Pick } from "./martyDelivery.ts";
import { formatScreenContextInstructions, type ScreenContext } from "./screenContext.ts";

export const ELEVENLABS_API = "https://api.elevenlabs.io";
// Rob's own voice "Marty", saved by Rob in ElevenLabs. Not a secret: it only works with Rob's key.
export const MARTY_VOICE_ID = "p9Y6zzVEQV7SMw7VcCkd";
export const MARTY_AGENT_NAME = "Marty (Harmony Discover live)";
// English-only agents use the low-latency Flash voice model.
export const AGENT_TTS_MODEL = "eleven_flash_v2";
export const SESSION_VARIABLE = "marty_session";
// How Marty's ElevenLabs voice is delivered and how patient he is about turns (P-20261126-0320). Sent on agent create
// and every sync, so these overwrite any dashboard value for the same fields. If ElevenLabs refuses them (400/422),
// the server retries without them (tools kept), then plain, so a refused setting can never take Marty down.
//  - speed 0.95: a touch slower than ElevenLabs' 1.0 default, so punchlines and serious moments land.
//  - stability 0.4: a bit below the 0.5 default, so the voice varies more: pauses, dry laughs, slower warm-ups.
//  - turn_eagerness "patient": waits longer before deciding the guest is done, so he does not cut them off.
export const AGENT_VOICE_TUNING = { speed: 0.95, stability: 0.4 } as const;
export const AGENT_TURN_TUNING = { turn_eagerness: "patient" } as const;

// ---- which voice engine ------------------------------------------------------------------------
// THE SWITCH. Code default is ElevenLabs. Undo without any new secret: change this one line to "openai" and
// redeploy discover-voice-session (or, if Rob ever wants it, set the optional secret MARTY_VOICE_ENGINE=openai).
export type VoiceEngine = "elevenlabs" | "openai";
export const DEFAULT_VOICE_ENGINE: VoiceEngine = "elevenlabs";
export const VOICE_ENGINES: readonly string[] = ["elevenlabs", "openai"];
export type ElevenConnection = "webrtc" | "websocket";
export const ELEVEN_CONNECTIONS: readonly string[] = ["webrtc", "websocket"];

export function resolveVoiceEngine(overrideEnv: string | undefined | null, codeDefault: VoiceEngine = DEFAULT_VOICE_ENGINE): VoiceEngine {
  const v = (overrideEnv ?? "").trim().toLowerCase();
  return v === "openai" || v === "elevenlabs" ? v : codeDefault;
}

// Old app copies send no voiceEngines field and can only play OpenAI, so they always get today's OpenAI grant.
export function chooseEngine(
  switchEngine: VoiceEngine, appEngines: readonly VoiceEngine[] | null, elevenLabsKeySet: boolean,
): VoiceEngine {
  if (switchEngine !== "elevenlabs") return "openai";
  if (!appEngines || !appEngines.includes("elevenlabs")) return "openai";
  return elevenLabsKeySet ? "elevenlabs" : "openai";
}

// ---- Marty's script, split shared / per guest --------------------------------------------------
export interface ElevenPromptArgs {
  mode: VoiceMode;
  handsFreeEnv?: string | null;
  characterBook?: string;
  lookupsEnabled?: boolean;
  screenContext?: ScreenContext | null;
  memoryContext?: string;
  pick?: Pick;
}
// Same pieces, same order and same words as buildRealtimeSession; only the per-guest pieces move to the end,
// into {{marty_session}}.
export function buildElevenLabsPrompt(args: ElevenPromptArgs) {
  const lookups = args.lookupsEnabled !== false;
  const book = (args.characterBook ?? "").trim();
  const shared = martyBostonInstructions + MARTY_NO_HOST_MANNERS + martyBostonComedyCraft +
    (book ? `\n\nMARTY CHARACTER BOOK\n${book}\n` : "") +
    martyDeliveryInstructions +
    DISCOVER_NAVIGATION_INSTRUCTIONS +
    (lookups ? MARTY_LOOKUP_INSTRUCTIONS : "") +
    `\n\nTHIS SESSION\n{{${SESSION_VARIABLE}}}\n`;
  const flavor = pickSessionFlavor(args.pick);
  const session = (formatSessionFlavor(flavor) +
    formatScreenContextInstructions(args.screenContext ?? null) +
    (args.memoryContext ?? "")).trim();
  const mode = resolveMode(args.mode, args.handsFreeEnv);
  return { shared, session, flavor, mode, lookups };
}

// OpenAI-style tool list -> ElevenLabs client tools (run by the app, like today).
// Navigation tools: the app acts, no answer needed. Look-ups: the app asks this server and hands the result back.
type Schema = { type?: string; properties?: Record<string, Record<string, unknown>>; required?: readonly string[] };
function toElevenParameters(p: Schema) {
  const properties: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(p.properties ?? {})) {
    const { ...copy } = prop;
    if (typeof copy.description !== "string") copy.description = name.replace(/_/g, " ");
    properties[name] = copy;
  }
  return { type: "object", properties, required: [...(p.required ?? [])] };
}
export function buildClientTools(lookupsEnabled: boolean) {
  const nav = DISCOVER_NAVIGATION_TOOLS.map((t) => ({
    type: "client", name: t.name, description: t.description,
    parameters: toElevenParameters(t.parameters as unknown as Schema), expects_response: false,
  }));
  const look = lookupsEnabled
    ? MARTY_LOOKUP_TOOLS.map((t) => ({
      type: "client", name: t.name, description: t.description,
      parameters: toElevenParameters(t.parameters as unknown as Schema), expects_response: true, response_timeout_secs: 20,
    }))
    : [];
  return [...nav, ...look];
}

export function buildAgentConfig(
  sharedPrompt: string, voiceId: string, opts: { llm?: string; tools?: unknown[]; tuning?: boolean } = {},
) {
  const prompt: Record<string, unknown> = { prompt: sharedPrompt };
  if (opts.llm) prompt.llm = opts.llm;
  const agent: Record<string, unknown> = { prompt, language: "en" };
  if (opts.tools) {
    prompt.tools = opts.tools;
    agent.dynamic_variables = { dynamic_variable_placeholders: { [SESSION_VARIABLE]: "(nothing extra this session)" } };
  }
  return {
    name: MARTY_AGENT_NAME,
    conversation_config: opts.tuning
      ? { agent, tts: { voice_id: voiceId, model_id: AGENT_TTS_MODEL, ...AGENT_VOICE_TUNING }, turn: { ...AGENT_TURN_TUNING } }
      : { agent, tts: { voice_id: voiceId, model_id: AGENT_TTS_MODEL } },
    // Sign-in required: id-only conversations are refused by ElevenLabs; only our server's token works.
    platform_settings: { auth: { enable_auth: true } },
  };
}

// ---- calls -------------------------------------------------------------------------------------
export interface ElevenEnv { apiKey: string; voiceId?: string; agentId?: string; llm?: string }
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export type ElevenResult =
  | { ok: true; voiceId: string; agentId: string; token?: string; signedUrl?: string; clientTools: string[] }
  | { ok: false; step: string; status: number };

function headers(apiKey: string): Record<string, string> {
  return { "xi-api-key": apiKey, "Content-Type": "application/json" };
}
async function call(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try { res = await fetchImpl(url, init); } catch { return { status: 0, body: null }; }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* handled by caller */ }
  return { status: res.ok ? 200 : res.status, body };
}
const str = (v: unknown) => (typeof v === "string" && v ? v : "");

function authTurnedOff(body: unknown): boolean {
  const auth = (body as { platform_settings?: { auth?: { enable_auth?: unknown } } })?.platform_settings?.auth;
  return !!auth && "enable_auth" in auth && auth.enable_auth !== true;
}
async function checkVoice(f: FetchLike, key: string, voiceId: string): Promise<{ step: string; status: number } | null> {
  const r = await call(f, `${ELEVENLABS_API}/v1/voices/${encodeURIComponent(voiceId)}`, { method: "GET", headers: { "xi-api-key": key } });
  if (r.status === 200 && str((r.body as { voice_id?: unknown })?.voice_id) === voiceId) return null;
  if (r.status === 200 || r.status === 400 || r.status === 404 || r.status === 422) return { step: "voice_not_found", status: r.status };
  return { step: "voice_check", status: r.status };
}
type AgentRow = { agent_id?: unknown; name?: unknown; created_at_unix_secs?: unknown };
const MAX_LIST_PAGES = 10;
function pickOurs(agents: AgentRow[]): string {
  const ours = agents.filter((a) => a?.name === MARTY_AGENT_NAME && str(a.agent_id));
  ours.sort((a, b) => (Number(a.created_at_unix_secs) || 0) - (Number(b.created_at_unix_secs) || 0));
  return ours.length ? str(ours[0].agent_id) : "";
}
async function findAgent(f: FetchLike, key: string): Promise<{ id: string } | { step: string; status: number }> {
  const r = await call(f, `${ELEVENLABS_API}/v1/convai/agents?search=${encodeURIComponent(MARTY_AGENT_NAME)}&page_size=100`, { method: "GET", headers: headers(key) });
  if (r.status !== 200) return { step: "agent_list", status: r.status };
  const hit = pickOurs((r.body as { agents?: AgentRow[] })?.agents ?? []);
  if (hit) return { id: hit };
  let cursor = "";
  const all: AgentRow[] = [];
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const q = `page_size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const p = await call(f, `${ELEVENLABS_API}/v1/convai/agents?${q}`, { method: "GET", headers: headers(key) });
    if (p.status !== 200) return { step: "agent_list", status: p.status };
    const b = p.body as { agents?: AgentRow[]; has_more?: unknown; next_cursor?: unknown };
    all.push(...(b?.agents ?? []));
    cursor = str(b?.next_cursor);
    if (b?.has_more !== true || !cursor) break;
  }
  return { id: pickOurs(all) };
}

// Per server copy (warm instance) memory: skips repeat voice checks, agent searches and identical updates, so a
// start is usually just one token call. Holds no guest data: only ids and a fingerprint of the shared script.
export interface ElevenCache { voiceOk?: string; agentId?: string; synced?: string; tools?: string[] }
export const elevenCache: ElevenCache = {};
async function fingerprint(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const REFUSED_SHAPE = new Set([400, 422]);

// Never returns, logs or forwards a provider body or key: only the failing step name and status code.
export async function mintElevenLabs(
  sharedPrompt: string, lookupsEnabled: boolean, env: ElevenEnv, connection: ElevenConnection = "webrtc",
  fetchImpl: FetchLike = fetch, cache: ElevenCache = elevenCache,
): Promise<ElevenResult> {
  const key = env.apiKey;
  const voiceId = (env.voiceId ?? "").trim() || MARTY_VOICE_ID;
  if (cache.voiceOk !== voiceId) {
    const missing = await checkVoice(fetchImpl, key, voiceId);
    if (missing) return { ok: false, ...missing };
    cache.voiceOk = voiceId;
  }
  const llm = (env.llm ?? "").trim() || undefined;
  const tools = buildClientTools(lookupsEnabled);
  let toolNames: string[] = cache.tools ?? tools.map((t) => t.name);
  // Tried in order on a 400/422 refusal: tuned (tools + voice/turn tuning), then tools only, then plain.
  const tuned = buildAgentConfig(sharedPrompt, voiceId, { llm, tools, tuning: true });
  const full = buildAgentConfig(sharedPrompt, voiceId, { llm, tools });
  const plain = buildAgentConfig(sharedPrompt, voiceId, { llm });
  const attempts: { body: unknown; names: string[] }[] = [
    { body: tuned, names: tools.map((t) => t.name) },
    { body: full, names: tools.map((t) => t.name) },
    { body: plain, names: [] },
  ];
  const send = async (url: string, method: string) => {
    let r = { status: 0, body: null as unknown };
    for (const a of attempts) {
      r = await call(fetchImpl, url, { method, headers: headers(key), body: JSON.stringify(a.body) });
      toolNames = a.names;
      if (!REFUSED_SHAPE.has(r.status)) break;
    }
    return r;
  };
  const print = await fingerprint(JSON.stringify(tuned));

  let agentId = (env.agentId ?? "").trim() || cache.agentId || "";
  if (!agentId) {
    const found = await findAgent(fetchImpl, key);
    if ("step" in found) return { ok: false, ...found };
    agentId = found.id;
  }
  if (!agentId) {
    const c = await send(`${ELEVENLABS_API}/v1/convai/agents/create`, "POST");
    agentId = str((c.body as { agent_id?: unknown })?.agent_id);
    if (c.status !== 200 || !agentId) return { ok: false, step: "agent_create", status: c.status };
    if (authTurnedOff(c.body)) return { ok: false, step: "agent_auth", status: c.status };
    cache.synced = print;
  } else if (cache.synced !== print || cache.agentId !== agentId) {
    // Keep the agent's shared script identical to today's Marty; only when it changed since this copy last synced.
    const url = `${ELEVENLABS_API}/v1/convai/agents/${encodeURIComponent(agentId)}`;
    const u = await send(url, "PATCH");
    if (u.status !== 200) return { ok: false, step: "agent_update", status: u.status };
    if (authTurnedOff(u.body)) return { ok: false, step: "agent_auth", status: u.status };
    cache.synced = print;
  }
  cache.agentId = agentId;
  cache.tools = toolNames;

  if (connection === "websocket") {
    const w = await call(fetchImpl, `${ELEVENLABS_API}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, { method: "GET", headers: { "xi-api-key": key } });
    const signedUrl = str((w.body as { signed_url?: unknown })?.signed_url);
    if (w.status !== 200 || !signedUrl.startsWith("wss://")) return { ok: false, step: "signed_url", status: w.status };
    return { ok: true, signedUrl, voiceId, agentId, clientTools: toolNames };
  }
  const t = await call(fetchImpl, `${ELEVENLABS_API}/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`, { method: "GET", headers: { "xi-api-key": key } });
  const token = str((t.body as { token?: unknown })?.token);
  if (t.status !== 200 || !token) return { ok: false, step: "token", status: t.status };
  return { ok: true, token, voiceId, agentId, clientTools: toolNames };
}

// What the app gets for an ElevenLabs start. Only new app copies (which listed "elevenlabs") ever see this shape.
export function elevenLabsGrant(r: Extract<ElevenResult, { ok: true }>, session: string, mode: VoiceMode, connection: ElevenConnection) {
  const body: Record<string, unknown> = {
    sessionId: crypto.randomUUID(),
    provider: "elevenlabs_agents",
    transport: connection,
    connectHint: "elevenlabs",
    model: "elevenlabs",
    voice: "elevenlabs",
    mode,
    dynamicVariables: { [SESSION_VARIABLE]: session || "(nothing extra this session)" },
    clientTools: r.clientTools,
  };
  if (connection === "websocket") body.signedUrl = r.signedUrl;
  else body.conversationToken = r.token;
  return body;
}
