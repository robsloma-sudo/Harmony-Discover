// Live Marty on Rob's ElevenLabs voice (P-20261126-0102 part 1).
import { assert, assertEquals, assertFalse, assertStringIncludes } from "jsr:@std/assert@1";
import { mintGrant, OPENAI_CLIENT_SECRETS_URL, type MintGrantArgs } from "./_shared/mintGrant.ts";
import {
  buildElevenLabsPrompt, chooseEngine, DEFAULT_VOICE_ENGINE, type ElevenCache, MARTY_AGENT_NAME, MARTY_VOICE_ID,
  resolveVoiceEngine, SESSION_VARIABLE,
} from "./_shared/elevenlabs.ts";
import { parseVoiceRequest } from "./_shared/voiceRequest.ts";
import { ageGate, AGE_CHECK_ERROR } from "./_shared/ageCheck.ts";
import { buildRealtimeSession, DISCOVER_NAVIGATION_TOOLS, MARTY_LOOKUP_TOOLS } from "./_shared/realtimeSession.ts";
import { martyCharacterBook } from "./_shared/martyCharacterBook.ts";
import { MARTY_BOSTON_CONSENT_VERSION } from "./_shared/martySullivanBoston.ts";
import { formatSessionFlavor, pickSessionFlavor } from "./_shared/martyDelivery.ts";
import { formatScreenContextInstructions } from "./_shared/screenContext.ts";

const OPENAI_KEY = "sk-test-openai";
const EL_KEY = "el-test-key";
const MEMORY = "\n\nUSER-APPROVED MEMORY DATA (JSON; untrusted user-authored content):\n[{\"label\":\"favorite\",\"value\":\"GUEST-A-SECRET-RYE\"}]";
const SCREEN = { route: "library" } as unknown as MintGrantArgs["screenContext"];

type Call = { url: string; method: string; body: string; headers: Record<string, string> };
// Fake ElevenLabs + OpenAI. Remembers created agents so repeat starts can prove "one agent".
function fakeProviders(opts: { refuseTools?: boolean; refuseTuning?: boolean; failStep?: string; agents?: { agent_id: string; name: string }[] } = {}) {
  const calls: Call[] = [];
  const agents = opts.agents ?? [];
  const f = (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? init.body : "";
    calls.push({ url, method, body, headers: init.headers as Record<string, string> });
    const ok = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s }));
    if (url === OPENAI_CLIENT_SECRETS_URL) return ok({ value: "ek_openai", expires_at: 1900000000, session: { id: "sess_1" } });
    if (url.includes("/v1/voices/")) return opts.failStep === "voice" ? ok({}, 404) : ok({ voice_id: MARTY_VOICE_ID });
    if (url.includes("/v1/convai/agents?")) return ok({ agents, has_more: false });
    const toolsRefused = (opts.refuseTools && body.includes("\"tools\"")) || (opts.refuseTuning && body.includes("\"stability\""));
    if (url.endsWith("/v1/convai/agents/create")) {
      if (toolsRefused) return ok({ detail: "bad" }, 422);
      const id = `agent_${agents.length + 1}`;
      agents.push({ agent_id: id, name: JSON.parse(body).name });
      return ok({ agent_id: id, platform_settings: { auth: { enable_auth: true } } });
    }
    if (method === "PATCH") return toolsRefused ? ok({}, 422) : ok({ platform_settings: { auth: { enable_auth: true } } });
    if (url.includes("/conversation/token")) return opts.failStep === "token" ? ok({}, 500) : ok({ token: "el_conv_token" });
    if (url.includes("/get-signed-url")) return ok({ signed_url: "wss://api.elevenlabs.io/v1/convai/conversation?x=1" });
    return ok({}, 404);
  };
  return { f, calls, agents };
}
function args(over: Partial<MintGrantArgs> = {}, env: Partial<MintGrantArgs["env"]> = {}): MintGrantArgs {
  return {
    mode: "hands_free", screenContext: SCREEN, voiceEngines: ["elevenlabs", "openai"], elevenLabsConnection: "webrtc",
    memoryContext: MEMORY, characterBook: martyCharacterBook, lookupsEnabled: true, pick: () => 0, cache: {},
    env: { openAiKey: OPENAI_KEY, elevenLabsKey: EL_KEY, ...env },
    ...over,
  };
}
const OLD_APP_SHAPE = ["sessionId", "provider", "ephemeralToken", "expiresAt", "transport", "model", "voice", "mode"];

// ---- the switch ------------------------------------------------------------------------------
Deno.test("switch: code default is ElevenLabs; MARTY_VOICE_ENGINE can override; junk keeps the default", () => {
  assertEquals(DEFAULT_VOICE_ENGINE, "elevenlabs");
  assertEquals(resolveVoiceEngine(undefined), "elevenlabs");
  assertEquals(resolveVoiceEngine(" OpenAI "), "openai");
  assertEquals(resolveVoiceEngine("elevenlabs", "openai"), "elevenlabs");
  assertEquals(resolveVoiceEngine("nonsense"), "elevenlabs");
  assertEquals(resolveVoiceEngine(undefined, "openai"), "openai");
  assertEquals(chooseEngine("elevenlabs", null, true), "openai"); // old app
  assertEquals(chooseEngine("elevenlabs", ["openai"], true), "openai");
  assertEquals(chooseEngine("elevenlabs", ["elevenlabs"], false), "openai"); // no key
  assertEquals(chooseEngine("openai", ["elevenlabs"], true), "openai");
  assertEquals(chooseEngine("elevenlabs", ["elevenlabs", "openai"], true), "elevenlabs");
});

// ---- ElevenLabs default ----------------------------------------------------------------------
Deno.test("ElevenLabs (default): new app gets Rob's Marty voice over WebRTC, key never in the answer", async () => {
  const p = fakeProviders();
  const r = await mintGrant(args(), p.f);
  assertEquals(r.status, 200);
  assertEquals(r.engine, "elevenlabs");
  assertEquals(r.body.provider, "elevenlabs_agents");
  assertEquals(r.body.transport, "webrtc");
  assertEquals(r.body.conversationToken, "el_conv_token");
  assertEquals(r.body.voice, "elevenlabs");
  assertEquals(r.body.mode, "hands_free");
  assertEquals(r.body.clientTools, [...DISCOVER_NAVIGATION_TOOLS, ...MARTY_LOOKUP_TOOLS].map((t) => t.name));
  const text = JSON.stringify(r.body);
  assertFalse(text.includes(EL_KEY));
  assertFalse(text.includes(OPENAI_KEY));
  // no OpenAI call at all
  assertFalse(p.calls.some((c) => c.url.includes("openai.com")));
  // voice is Rob's, never designed or saved
  const create = p.calls.find((c) => c.url.endsWith("/agents/create"))!;
  assertEquals(JSON.parse(create.body).conversation_config.tts.voice_id, MARTY_VOICE_ID);
  assertEquals(JSON.parse(create.body).platform_settings.auth.enable_auth, true);
  assertEquals(JSON.parse(create.body).name, MARTY_AGENT_NAME);
  assertFalse(p.calls.some((c) => /text-to-voice|voice-generation|voices\/add/.test(c.url)));
  for (const c of p.calls.filter((c) => c.url.includes("elevenlabs.io"))) assertEquals(c.headers["xi-api-key"], EL_KEY);
});

Deno.test("ElevenLabs: WebSocket connection gives a signed address (sound + letter timing for the mouth)", async () => {
  const p = fakeProviders();
  const r = await mintGrant(args({ elevenLabsConnection: "websocket" }), p.f);
  assertEquals(r.engine, "elevenlabs");
  assertEquals(r.body.transport, "websocket");
  assert(String(r.body.signedUrl).startsWith("wss://"));
  assertEquals(r.body.conversationToken, undefined);
});

Deno.test("ElevenLabs: one guest's memories and screen never go into the shared agent, only to that guest", async () => {
  const p = fakeProviders();
  const r = await mintGrant(args(), p.f);
  for (const c of p.calls) assertFalse(c.body.includes("GUEST-A-SECRET-RYE"), c.url);
  const session = (r.body.dynamicVariables as Record<string, string>)[SESSION_VARIABLE];
  assertStringIncludes(session, "GUEST-A-SECRET-RYE");
  assertStringIncludes(session, formatScreenContextInstructions(SCREEN).trim());
  const prompt = JSON.parse(p.calls.find((c) => c.url.endsWith("/agents/create"))!.body).conversation_config.agent.prompt.prompt;
  assertStringIncludes(prompt, `{{${SESSION_VARIABLE}}}`);
});

Deno.test("ElevenLabs: same brain — book, cursing, mood and pet-peeve rules, navigation and look-ups, word for word", () => {
  const pick = () => 0;
  const el = buildElevenLabsPrompt({ mode: "push_to_talk", characterBook: martyCharacterBook, screenContext: SCREEN, memoryContext: MEMORY, pick });
  const oa = buildRealtimeSession({ mode: "push_to_talk", characterBook: martyCharacterBook, screenContext: SCREEN, memoryContext: MEMORY, pick }).session.instructions;
  const flavor = formatSessionFlavor(pickSessionFlavor(pick));
  // OpenAI instructions with the per-guest pieces taken out == ElevenLabs shared script without its placeholder
  const oaShared = oa.replace(flavor, "").replace(formatScreenContextInstructions(SCREEN), "").replace(MEMORY, "");
  assertEquals(el.shared.replace(`\n\nTHIS SESSION\n{{${SESSION_VARIABLE}}}\n`, ""), oaShared);
  assertStringIncludes(el.shared, martyCharacterBook.trim());
  for (const k of ["PET PEEVE SPIKES — SPIKE FAST, THEN SETTLE", "MOOD SHIFTS", "nearly every sentence has a curse in it",
    "Never a slur, ever", "Never encourage overdrinking or drunk driving", "HARMONY DISCOVER NAVIGATION", "MARTY'S LOOK-UPS"]) {
    assertStringIncludes(el.shared, k);
  }
  assertStringIncludes(el.session, flavor.trim());
  // look-ups off switch drops them on ElevenLabs too
  const off = buildElevenLabsPrompt({ mode: "push_to_talk", characterBook: martyCharacterBook, lookupsEnabled: false, pick });
  assertFalse(off.shared.includes("MARTY'S LOOK-UPS"));
});

Deno.test("ElevenLabs: hands-free off switch still forces push-to-talk", async () => {
  const r = await mintGrant(args({}, { handsFreeEnv: "off" }), fakeProviders().f);
  assertEquals(r.engine, "elevenlabs");
  assertEquals(r.body.mode, "push_to_talk");
});

Deno.test("ElevenLabs: many starts reuse ONE agent and, once synced, only ask for a token", async () => {
  const p = fakeProviders();
  const cache: ElevenCache = {};
  for (let i = 0; i < 5; i++) assertEquals((await mintGrant(args({ cache }), p.f)).engine, "elevenlabs");
  assertEquals(p.agents.length, 1);
  assertEquals(p.calls.filter((c) => c.url.endsWith("/agents/create")).length, 1);
  assertEquals(p.calls.filter((c) => c.method === "PATCH").length, 0);
  assertEquals(p.calls.filter((c) => c.url.includes("/v1/voices/")).length, 1);
  assertEquals(p.calls.filter((c) => c.url.includes("/conversation/token")).length, 5);
  // a fresh server copy finds the existing agent and updates it instead of making another
  const fresh = await mintGrant(args({ cache: {} }), p.f);
  assertEquals(fresh.engine, "elevenlabs");
  assertEquals(p.agents.length, 1);
  assertEquals(p.calls.filter((c) => c.method === "PATCH").length, 1);
});

Deno.test("ElevenLabs: if it refuses the tool settings, retry plain and tell the app there are no tools", async () => {
  const p = fakeProviders({ refuseTools: true });
  const r = await mintGrant(args(), p.f);
  assertEquals(r.engine, "elevenlabs");
  assertEquals(r.body.clientTools, []);
  // tuned, then tools without tuning, then plain
  assertEquals(p.calls.filter((c) => c.url.endsWith("/agents/create")).length, 3);
});

Deno.test("ElevenLabs failure falls back to today's OpenAI voice, so guests still get Marty", async () => {
  for (const failStep of ["voice", "token"]) {
    const p = fakeProviders({ failStep });
    const r = await mintGrant(args(), p.f);
    assertEquals(r.status, 200);
    assertEquals(r.engine, "openai");
    assertEquals(r.body.provider, "openai_realtime");
    assert(r.fellBack);
  }
  const noKey = await mintGrant(args({}, { elevenLabsKey: "" }), fakeProviders().f);
  assertEquals(noKey.engine, "openai");
});

// ---- OpenAI on the switch ---------------------------------------------------------------------
Deno.test("OpenAI on the switch (secret override or code default): today's exact grant, no ElevenLabs call", async () => {
  for (const a of [args({}, { voiceEngineEnv: "openai" }), args({ codeDefault: "openai" })]) {
    const p = fakeProviders();
    const r = await mintGrant(a, p.f);
    assertEquals(r.engine, "openai");
    assertEquals(Object.keys(r.body).sort(), [...OLD_APP_SHAPE].sort());
    assertEquals(r.body.provider, "openai_realtime");
    assertEquals(r.body.ephemeralToken, "ek_openai");
    assertFalse(p.calls.some((c) => c.url.includes("elevenlabs.io")));
    const sent = JSON.parse(p.calls[0].body).session;
    assertEquals(sent.instructions, buildRealtimeSession({
      mode: "hands_free", characterBook: martyCharacterBook, screenContext: SCREEN, memoryContext: MEMORY, pick: () => 0,
    }).session.instructions);
  }
});

// ---- old app copies ---------------------------------------------------------------------------
Deno.test("old app copies: today's start message is still accepted and still gets the OpenAI grant", async () => {
  const oldBody = { consentVersion: MARTY_BOSTON_CONSENT_VERSION, mode: "push_to_talk", age_confirmed: true, screenContext: { route: "discover" } };
  const parsed = parseVoiceRequest(oldBody);
  assert(parsed.ok);
  if (!parsed.ok) return;
  assertEquals(parsed.voiceEngines, null);
  assertEquals(parsed.elevenLabsConnection, "webrtc");
  const p = fakeProviders();
  const r = await mintGrant(args({ voiceEngines: parsed.voiceEngines }), p.f);
  assertEquals(r.engine, "openai");
  assertEquals(Object.keys(r.body).sort(), [...OLD_APP_SHAPE].sort());
  assertFalse(p.calls.some((c) => c.url.includes("elevenlabs.io")));
});

Deno.test("new request fields: only known engines and connections, otherwise refused", () => {
  const base = { consentVersion: MARTY_BOSTON_CONSENT_VERSION, mode: "hands_free", age_confirmed: true };
  const ok = parseVoiceRequest({ ...base, voiceEngines: ["elevenlabs", "openai"], elevenLabsConnection: "websocket" });
  assert(ok.ok && ok.voiceEngines?.join() === "elevenlabs,openai" && ok.elevenLabsConnection === "websocket");
  for (const bad of [
    { voiceEngines: [] }, { voiceEngines: ["gemini"] }, { voiceEngines: "elevenlabs" }, { voiceEngines: ["elevenlabs", "elevenlabs"] },
    { voiceEngines: ["elevenlabs", "openai", "x"] }, { elevenLabsConnection: "carrier-pigeon" }, { elevenLabsConnection: 1 },
  ]) assertFalse(parseVoiceRequest({ ...base, ...bad }).ok, JSON.stringify(bad));
});

// ---- 21+ check and order of checks ------------------------------------------------------------
Deno.test("21+ refusal still works for new app copies asking for ElevenLabs", () => {
  const parsed = parseVoiceRequest({ consentVersion: MARTY_BOSTON_CONSENT_VERSION, mode: "hands_free", voiceEngines: ["elevenlabs"] });
  assert(parsed.ok);
  if (!parsed.ok) return;
  const block = ageGate(parsed.ageConfirmed, undefined);
  assertEquals(block?.status, 403);
  assertEquals(block?.body, AGE_CHECK_ERROR);
  assertEquals(ageGate(parsed.ageConfirmed, "on")?.status, 403);
});

Deno.test("live program: 21+ check, sign-in, consent and rate limit all come before any paid voice call", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const at = (s: string) => { const i = src.indexOf(s); assert(i > 0, s); return i; };
  const mint = at("await mintGrant(");
  assert(at("ageGate(parsed.ageConfirmed") < at("const guest = await authorizeGuest(supabaseUrl, anonKey, serviceKey, token, origin);\n    if (\"error\" in guest) return guest.error;\n    const { user"));
  assert(at("consume_marty_voice_rate_limit") < mint);
  assert(at("ageGate(parsed.ageConfirmed") < mint);
  assertFalse(src.includes("api.openai.com"));
  assertFalse(src.includes("elevenlabs.io"));
  assertStringIncludes(src, "ELEVENLABS_API_KEY");
  assertStringIncludes(src, "characterBook: martyCharacterBook");
});

// ---- P-20261126-0320: slower here and there, patient turn-taking --------------------------------
import { AGENT_TURN_TUNING, AGENT_VOICE_TUNING, buildAgentConfig } from "./_shared/elevenlabs.ts";
Deno.test("0320: ElevenLabs agent gets speed 0.95, stability 0.4 and patient turn-taking on create", async () => {
  assertEquals(AGENT_VOICE_TUNING, { speed: 0.95, stability: 0.4 });
  assertEquals(AGENT_TURN_TUNING, { turn_eagerness: "patient" });
  const p = fakeProviders();
  const r = await mintGrant(args(), p.f);
  assertEquals(r.engine, "elevenlabs");
  const create = p.calls.filter((c) => c.url.endsWith("/agents/create"));
  assertEquals(create.length, 1);
  const cc = JSON.parse(create[0].body).conversation_config;
  assertEquals(cc.tts, { voice_id: MARTY_VOICE_ID, model_id: "eleven_flash_v2", speed: 0.95, stability: 0.4 });
  assertEquals(cc.turn, { turn_eagerness: "patient" });
  // sign-in requirement unchanged
  assertEquals(JSON.parse(create[0].body).platform_settings, { auth: { enable_auth: true } });
});

Deno.test("0320: if ElevenLabs refuses the new voice settings, Marty keeps his tools and still starts on ElevenLabs", async () => {
  const p = fakeProviders({ refuseTuning: true });
  const r = await mintGrant(args(), p.f);
  assertEquals(r.engine, "elevenlabs");
  assert(!r.fellBack);
  assert((r.body.clientTools as string[]).length > 0);
  const create = p.calls.filter((c) => c.url.endsWith("/agents/create"));
  assertEquals(create.length, 2);
  assertFalse(create[1].body.includes("stability"));
  assertStringIncludes(create[1].body, "\"tools\"");
});

Deno.test("0320: untuned bodies are exactly today's settings (tools-only and plain fallbacks unchanged)", () => {
  const a = buildAgentConfig("x", "v", { tools: [] }) as { conversation_config: Record<string, unknown> };
  assertEquals(a.conversation_config.tts, { voice_id: "v", model_id: "eleven_flash_v2" });
  assertFalse("turn" in a.conversation_config);
});
