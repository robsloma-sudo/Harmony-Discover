import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  buildGeminiTokenBody, buildGptLiveSession, compareAllowed, DEFAULT_ORDER, GEMINI_AUTH_TOKENS_URL,
  GPT_LIVE_SESSIONS_URL, MARTY_BOSTON_CONSENT_VERSION, MAX_REQUEST_BYTES, MAX_SDP_BYTES, mintContender,
  OPENAI_CLIENT_SECRETS_URL, parseCompareRequest, parseOrder, resolveContender,
} from "./_shared/compare.ts";
import { DEPLOY_FILES } from "./_shared/compare.ts";
import {
  buildRealtimeSession, DISCOVER_NAVIGATION_TOOLS, MARTY_LOOKUP_INSTRUCTIONS, MARTY_LOOKUP_TOOLS,
} from "../discover-voice-session/_shared/realtimeSession.ts";
import { martyCharacterBook } from "../discover-voice-session/_shared/martyCharacterBook.ts";

const UID = "11111111-2222-3333-4444-555555555555";
const OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n";
const ANSWER = "v=0\r\no=openai 3 4 IN IP4 0.0.0.0\r\ns=-\r\n";
const LIVE_OK = { session: { id: "live_123", extra: "SECRET-PROVIDER-FIELD" }, transport: { type: "webrtc", sdp: ANSWER } };
const OK = { consentVersion: MARTY_BOSTON_CONSENT_VERSION, contender: "A", mode: "push_to_talk" };

Deno.test("gate: off, not listed, listed", () => {
  assertFalse(compareAllowed(undefined, UID, UID));
  assertFalse(compareAllowed("off", UID, UID));
  assertFalse(compareAllowed("on", "", UID));
  assertFalse(compareAllowed("on", undefined, UID));
  assertFalse(compareAllowed("on", "aaaa", UID));
  assertFalse(compareAllowed("on", UID, undefined));
  assert(compareAllowed("on", ` x , ${UID.toUpperCase()} `, UID));
});

Deno.test("mapping: default, custom, bad order falls back", () => {
  assertEquals(["A", "B", "C"].map((l) => resolveContender(undefined, l)), ["current", "gpt-live-1", "gemini"]);
  assertEquals(resolveContender("gemini,current,gpt-live-1", "A"), "gemini");
  assertEquals(parseOrder("current,current,gemini").join(","), DEFAULT_ORDER);
  assertEquals(parseOrder("nonsense").join(","), DEFAULT_ORDER);
  assertEquals(resolveContender(undefined, "D"), null);
});

Deno.test("request validation", () => {
  assert(parseCompareRequest(OK).ok);
  assert(parseCompareRequest({ ...OK, reveal: true, mode: "hands_free" }).ok);
  assertFalse(parseCompareRequest({ ...OK, reveal: "yes" }).ok);
  assertFalse(parseCompareRequest({ ...OK, contender: "D" }).ok);
  assertFalse(parseCompareRequest({ ...OK, mode: "x" }).ok);
  assertFalse(parseCompareRequest({ ...OK, consentVersion: "old" }).ok);
  assertFalse(parseCompareRequest({ ...OK, screenContext: {} }).ok);
  assertFalse(parseCompareRequest([]).ok);
  assertFalse(parseCompareRequest(null).ok);
  // voice B relay: an optional WebRTC offer, plain SDP text, size-capped
  const withSdp = parseCompareRequest({ ...OK, sdp: OFFER });
  assert(withSdp.ok && withSdp.sdp === OFFER);
  assertFalse(parseCompareRequest({ ...OK, sdp: "hello" }).ok);
  assertFalse(parseCompareRequest({ ...OK, sdp: 5 }).ok);
  assertFalse(parseCompareRequest({ ...OK, sdp: "v=0" + "a".repeat(MAX_SDP_BYTES) }).ok);
  assert(MAX_SDP_BYTES < MAX_REQUEST_BYTES);
});

function stub(status: number, payload: unknown, calls: { url: string; init: RequestInit }[] = []) {
  return (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(payload), { status }));
  };
}
const OPENAI_OK = { value: "ek_test", expires_at: 1800000000 };
const env = { openAiKey: "sk-secret", geminiKey: "gk-secret", voiceEnv: undefined, handsFreeEnv: undefined };

Deno.test("current: session equals buildRealtimeSession session; blind unless reveal", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const r = await mintContender({ contender: "A", mode: "push_to_talk", reveal: false }, env, stub(200, OPENAI_OK, calls));
  assertEquals(r.status, 200);
  assertEquals(r.body.connectHint, "realtime");
  assertEquals(r.body.provider, "openai_realtime");
  assertFalse("model" in r.body);
  const sent = JSON.parse(calls[0].init.body as string).session;
  // Same call as discover-voice-session/index.ts (character book in), with look-ups switched off.
  const expected = buildRealtimeSession({ mode: "push_to_talk", characterBook: martyCharacterBook, lookupsEnabled: false }).session;
  // flavor is random per build, so compare everything but instructions, and the instructions' fixed prefix
  assertEquals({ ...sent, instructions: "" }, { ...JSON.parse(JSON.stringify(expected)), instructions: "" });
  assertEquals(sent.model, "gpt-realtime-2.1");
  const rev = await mintContender({ contender: "A", mode: "hands_free", reveal: true }, env, stub(200, OPENAI_OK));
  assertEquals(rev.body.model, "gpt-realtime-2.1");
});

Deno.test("gpt-live-1: relayed by the server, never a browser pass", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const r = await mintContender({ contender: "B", mode: "hands_free", reveal: true, sdp: OFFER }, env, stub(201, LIVE_OK, calls));
  assertEquals(r.status, 200);
  // only the answer, the opaque session id and (on reveal) the model go back to the app
  assertEquals(r.body, { contender: "B", provider: "openai_live", transport: "webrtc_relay", sdpAnswer: ANSWER, sessionId: "live_123", model: "gpt-live-1" });
  assertFalse(JSON.stringify(r).includes("sk-secret"));
  assertFalse(JSON.stringify(r).includes("SECRET-PROVIDER-FIELD"));
  assertFalse("ephemeralToken" in r.body);
  // one call, to the live sessions address, with the server key, the app's offer forwarded unchanged
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, GPT_LIVE_SESSIONS_URL);
  assertEquals(calls[0].url, "https://api.openai.com/v1/live/sessions");
  assert(calls[0].url !== OPENAI_CLIENT_SECRETS_URL);
  assertEquals((calls[0].init.headers as Record<string, string>).Authorization, "Bearer sk-secret");
  assertEquals((calls[0].init.headers as Record<string, string>)["Content-Type"], "application/json");
  const sent = JSON.parse(calls[0].init.body as string);
  assertEquals(Object.keys(sent).sort(), ["session", "transport"]);
  assertEquals(sent.transport, { type: "webrtc", sdp: OFFER });
  assertEquals(Object.keys(sent.session).sort(), ["instructions", "model", "tools"]);
  assertEquals(sent.session.model, "gpt-live-1");
  assertEquals(sent.session.tools, JSON.parse(JSON.stringify(DISCOVER_NAVIGATION_TOOLS)));
  assert(sent.session.instructions.includes("HARMONY DISCOVER NAVIGATION"));
  // blind unless reveal
  const blind = await mintContender({ contender: "B", mode: "push_to_talk", reveal: false, sdp: OFFER }, env, stub(201, LIVE_OK));
  assertFalse("model" in blind.body);
  // no offer: refused before any call to OpenAI
  const noOffer: { url: string; init: RequestInit }[] = [];
  const r2 = await mintContender({ contender: "B", mode: "push_to_talk", reveal: false }, env, stub(201, LIVE_OK, noOffer));
  assertEquals(r2, { status: 400, body: { error: "This contender needs a connection offer.", needsOffer: true } });
  assertEquals(noOffer.length, 0);
  // a reply without a usable answer is a failure, status code only
  const bad = await mintContender({ contender: "B", mode: "push_to_talk", reveal: false, sdp: OFFER }, env, stub(201, { session: { id: "x" } }));
  assertEquals(bad, { status: 502, body: { error: "This contender could not start.", status: 201 } });
  const direct = buildGptLiveSession("hello");
  assertEquals(direct.instructions, "hello");
  for (const k of ["max_output_tokens", "speed", "turn_detection", "output_modalities", "client_secret", "expires_after"]) {
    assertFalse(JSON.stringify(direct).includes(k));
  }
});

Deno.test("voice A unchanged: still a one-time pass from client_secrets, offer ignored", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const r = await mintContender({ contender: "A", mode: "push_to_talk", reveal: false, sdp: OFFER }, env, stub(200, OPENAI_OK, calls));
  assertEquals(calls[0].url, OPENAI_CLIENT_SECRETS_URL);
  assertEquals(r.body.ephemeralToken, "ek_test");
  assertEquals(r.body.connectHint, "realtime");
  assertFalse(JSON.stringify(calls[0].init.body).includes("v=0"));
});

Deno.test("gemini: body shape, token returned, not configured", async () => {
  const body = buildGeminiTokenBody("be Marty", new Date("2026-11-25T10:00:00.000Z"));
  assertEquals(body.uses, 1);
  assertEquals(body.expireTime, "2026-11-25T10:30:00.000Z");
  assertEquals(body.newSessionExpireTime, "2026-11-25T10:01:00.000Z");
  assertEquals(body.liveConnectConstraints.model, "models/gemini-3.8-live");
  assertEquals(body.liveConnectConstraints.config.systemInstruction.parts[0].text, "be Marty");
  assertEquals(body.liveConnectConstraints.config.responseModalities, ["AUDIO"]);
  const calls: { url: string; init: RequestInit }[] = [];
  const r = await mintContender({ contender: "C", mode: "push_to_talk", reveal: false }, env, stub(200, { name: "auth_tokens/abc" }, calls));
  assertEquals(r.body, { contender: "C", provider: "gemini_live", ephemeralToken: "auth_tokens/abc", transport: "websocket" });
  assertEquals(calls[0].url, GEMINI_AUTH_TOKENS_URL);
  assertEquals((calls[0].init.headers as Record<string, string>)["x-goog-api-key"], "gk-secret");
  const rev = await mintContender({ contender: "C", mode: "push_to_talk", reveal: true }, env, stub(200, { name: "t" }));
  assertEquals(rev.body.model, "gemini-3.8-live");
  const none = await mintContender({ contender: "C", mode: "push_to_talk", reveal: false }, { ...env, geminiKey: "" }, stub(200, {}));
  assertEquals(none, { status: 503, body: { error: "Contender not configured." } });
});

Deno.test("errors: status only, never provider body, key or token", async () => {
  for (const letter of ["A", "B", "C"] as const) {
    const r = await mintContender({ contender: letter, mode: "push_to_talk", reveal: true, sdp: OFFER }, env,
      stub(400, { error: { message: "SECRET-PROVIDER-BODY sk-secret gk-secret" } }));
    assertEquals(r.status, 502);
    assertEquals(r.body, { error: "This contender could not start.", status: 400 });
    assertFalse(JSON.stringify(r).includes("SECRET"));
  }
  const thrown = await mintContender({ contender: "B", mode: "push_to_talk", reveal: false, sdp: OFFER }, env,
    () => Promise.reject(new Error("boom sk-secret")));
  assertEquals(thrown, { status: 502, body: { error: "This contender could not start.", status: 0 } });
});

Deno.test("custom order moves the models", async () => {
  const r = await mintContender({ contender: "A", mode: "push_to_talk", reveal: true, sdp: OFFER },
    { ...env, orderEnv: "gpt-live-1,gemini,current" }, stub(201, LIVE_OK));
  assertEquals(r.body.model, "gpt-live-1");
});

// CEO review of #140: the compared Marty must be the real Marty (character book in) and must never be told
// about, or handed, a tool this test cannot run (look-ups have no relay here).
Deno.test("every contender gets the character book and no look-up instructions or tools", async () => {
  const book = martyCharacterBook.trim();
  assert(book.length > 1000);
  const lookupNames = MARTY_LOOKUP_TOOLS.map((t) => t.name);
  const navNames = DISCOVER_NAVIGATION_TOOLS.map((t) => t.name);
  for (const letter of ["A", "B", "C"] as const) {
    for (const mode of ["push_to_talk", "hands_free"] as const) {
      const calls: { url: string; init: RequestInit }[] = [];
      const payload = letter === "C" ? { name: "t" } : letter === "B" ? LIVE_OK : OPENAI_OK;
      const r = await mintContender({ contender: letter, mode, reveal: false, sdp: OFFER }, env, stub(200, payload, calls));
      assertEquals(r.status, 200);
      const sent = JSON.parse(calls[0].init.body as string);
      const instructions: string = letter === "C"
        ? sent.liveConnectConstraints.config.systemInstruction.parts[0].text
        : sent.session.instructions;
      assert(instructions.includes("MARTY CHARACTER BOOK"), `${letter} ${mode}: book header`);
      assert(instructions.includes(book), `${letter} ${mode}: full book text`);
      assertFalse(instructions.includes(MARTY_LOOKUP_INSTRUCTIONS.trim().split("\n")[0]), `${letter} ${mode}: look-up instructions`);
      for (const name of lookupNames) assertFalse(instructions.includes(name), `${letter} ${mode}: mentions ${name}`);
      if (letter !== "C") {
        const toolNames = sent.session.tools.map((t: { name: string }) => t.name);
        assertEquals(toolNames, navNames, `${letter} ${mode}: only navigation tools`);
      } else {
        assertFalse("tools" in sent.liveConnectConstraints.config, "gemini gets no tools at all");
      }
    }
  }
});

Deno.test("deploy list covers every file the function imports", async () => {
  const root = new URL("../", import.meta.url);
  const seen = new Set<string>();
  const walk = async (rel: string) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const text = await Deno.readTextFile(new URL(rel, root));
    for (const m of text.matchAll(/(?:import|export)[^"']*?from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      const next = new URL(m[1], new URL(rel, root)).href.slice(root.href.length);
      await walk(next);
    }
  };
  await walk("discover-voice-compare/index.ts");
  assertEquals([...seen].sort(), [...DEPLOY_FILES].sort());
});

// 21+ age check (P-20261125-2244 part 2): the listening test follows the same rule as Marty.
import { ageGate } from "../discover-voice-session/_shared/ageCheck.ts";
Deno.test("age: listening test request carries age_confirmed; gate refuses before any paid session", async () => {
  const none = parseCompareRequest(OK);
  assert(none.ok && none.ageConfirmed === false);
  const no = parseCompareRequest({ ...OK, age_confirmed: false });
  assert(no.ok && no.ageConfirmed === false);
  const yes = parseCompareRequest({ ...OK, age_confirmed: true });
  assert(yes.ok && yes.ageConfirmed === true);
  assertFalse(parseCompareRequest({ ...OK, age_confirmed: "yes" }).ok);
  assertEquals(ageGate(none.ok && none.ageConfirmed, undefined)?.body.code, "age_check_needed");
  assertEquals(ageGate(no.ok && no.ageConfirmed, undefined)?.status, 403);
  assertEquals(ageGate(yes.ok && yes.ageConfirmed, undefined), null);
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const gate = src.indexOf("ageGate(parsed.ageConfirmed");
  assert(gate > 0);
  for (const later of ["from(\"bartender_voice_consents\")", "consume_marty_voice_rate_limit", "mintContender(parsed"]) {
    assert(src.indexOf(later) > gate, `${later} must come after the age check`);
  }
});

// ---- ElevenLabs voice (P-20261126-0004 part 1) -------------------------------------------------
import {
  AGENT_TTS_MODEL, buildAgentConfig, ELEVENLABS_KEY_MISSING, MARTY_AGENT_NAME, MARTY_VOICE_ID,
} from "./_shared/elevenlabs.ts";

const EL_KEY = "EL-SECRET-KEY";
type Call = { url: string; init: RequestInit };
// Routes each ElevenLabs call to a canned answer; records every call.
function elStub(routes: Record<string, [number, unknown]>, calls: Call[]) {
  return (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const key = `${init.method} ${new URL(url).pathname}`;
    const hit = routes[key];
    if (!hit) return Promise.resolve(new Response("{}", { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(hit[1]), { status: hit[0] }));
  };
}
const EL_REQ = { contender: "A" as const, mode: "push_to_talk" as const, reveal: false, voice: "elevenlabs" as const };

Deno.test("elevenlabs: voice field accepted, optional, strict", () => {
  const p = parseCompareRequest({ ...OK, voice: "elevenlabs" });
  assert(p.ok && p.voice === "elevenlabs");
  const d = parseCompareRequest(OK);
  assert(d.ok && d.voice === "current");
  assert(parseCompareRequest({ ...OK, voice: "current" }).ok);
  assertFalse(parseCompareRequest({ ...OK, voice: "eleven" }).ok);
  assertFalse(parseCompareRequest({ ...OK, voice: 1 }).ok);
});

Deno.test("elevenlabs: no key -> exact key-missing message, no provider call", async () => {
  const calls: Call[] = [];
  const r = await mintContender(EL_REQ, { openAiKey: "k", geminiKey: "" }, elStub({}, calls));
  assertEquals(r.status, 503);
  assertEquals(r.body.error, ELEVENLABS_KEY_MISSING);
  assertEquals(ELEVENLABS_KEY_MISSING, "ElevenLabs key not set.");
  assertEquals(calls.length, 0);
});

const MV = "/v1/voices/p9Y6zzVEQV7SMw7VcCkd";

Deno.test("elevenlabs: Rob's Marty voice is the default", () => {
  assertEquals(MARTY_VOICE_ID, "p9Y6zzVEQV7SMw7VcCkd");
});

Deno.test("elevenlabs: first run uses Rob's Marty voice, creates agent with today's Marty script, returns token only", async () => {
  const calls: Call[] = [];
  const f = elStub({
    [`GET ${MV}`]: [200, { voice_id: MARTY_VOICE_ID, name: "Marty", category: "generated" }],
    "GET /v1/convai/agents": [200, { agents: [] }],
    "POST /v1/convai/agents/create": [200, { agent_id: "agent1" }],
    "GET /v1/convai/conversation/token": [200, { token: "conv-token", conversation_id: "c1", extra: "SECRET-PROVIDER-FIELD" }],
  }, calls);
  const r = await mintContender({ ...EL_REQ, reveal: true }, { openAiKey: "k", geminiKey: "", elevenLabsKey: EL_KEY }, f);
  assertEquals(r.status, 200);
  assertEquals(r.body, {
    contender: "A", provider: "elevenlabs_agents", conversationToken: "conv-token", transport: "webrtc",
    connectHint: "elevenlabs", voice: "elevenlabs", model: "elevenlabs",
  });
  // every call goes to the official API host with the key in the header only
  for (const c of calls) {
    assertEquals(new URL(c.url).host, "api.elevenlabs.io");
    assertFalse(c.url.includes(EL_KEY));
    assertEquals((c.init.headers as Record<string, string>)["xi-api-key"], EL_KEY);
  }
  assertFalse(JSON.stringify(r.body).includes(EL_KEY));
  assertFalse(JSON.stringify(r.body).includes("SECRET-PROVIDER-FIELD"));
  // the server never designs, saves or edits a voice
  assertFalse(calls.some((c) => c.url.includes("text-to-voice")));
  assertFalse(calls.some((c) => new URL(c.url).pathname.includes("/voices") && c.init.method !== "GET"));
  // agent gets exactly the same Marty instructions as contender A today
  const created = JSON.parse(String(calls.find((c) => c.url.endsWith("/agents/create"))!.init.body));
  const today = buildRealtimeSession({ voiceEnv: undefined, handsFreeEnv: undefined, mode: "push_to_talk", characterBook: martyCharacterBook, lookupsEnabled: false });
  // identical except the per-session random starting mood/opener, which every Marty session re-rolls
  const noFlavor = (t: string) => t.replace(/\nSESSION FLAVOR[\s\S]*?the rules above\.\n/, "");
  assertEquals(noFlavor(created.conversation_config.agent.prompt.prompt), noFlavor(today.session.instructions));
  assert(created.conversation_config.agent.prompt.prompt.includes("SESSION FLAVOR"));
  assert(created.conversation_config.agent.prompt.prompt.includes(martyCharacterBook.slice(0, 200)));
  assertEquals(created.conversation_config.tts, { voice_id: MARTY_VOICE_ID, model_id: AGENT_TTS_MODEL });
  assertEquals(created.name, MARTY_AGENT_NAME);
  assert(!("llm" in created.conversation_config.agent.prompt));
  const tok = calls.find((c) => c.url.includes("/conversation/token"))!;
  assertEquals(new URL(tok.url).searchParams.get("agent_id"), "agent1");
});

Deno.test("elevenlabs: later runs reuse the agent, refresh the script with Rob's voice", async () => {
  const calls: Call[] = [];
  const f = elStub({
    [`GET ${MV}`]: [200, { voice_id: MARTY_VOICE_ID }],
    "GET /v1/convai/agents": [200, { agents: [{ agent_id: "agent1", name: MARTY_AGENT_NAME }] }],
    "PATCH /v1/convai/agents/agent1": [200, { agent_id: "agent1" }],
    "GET /v1/convai/conversation/token": [200, { token: "t2" }],
  }, calls);
  const r = await mintContender({ ...EL_REQ, mode: "hands_free" }, { openAiKey: "k", geminiKey: "", elevenLabsKey: EL_KEY, elevenLabsLlm: "gemini-2.5-flash" }, f);
  assertEquals(r.status, 200);
  assertEquals(r.body.conversationToken, "t2");
  assert(!("model" in r.body));
  assertFalse(calls.some((c) => c.url.includes("text-to-voice")));
  assertFalse(calls.some((c) => c.url.includes("/agents/create")));
  const patch = JSON.parse(String(calls.find((c) => c.init.method === "PATCH")!.init.body));
  assertEquals(patch.conversation_config.agent.prompt.llm, "gemini-2.5-flash");
  assertEquals(patch.conversation_config.tts.voice_id, MARTY_VOICE_ID);
});

Deno.test("elevenlabs: ELEVENLABS_VOICE_ID and ELEVENLABS_AGENT_ID secrets override and skip the agent look-up", async () => {
  const calls: Call[] = [];
  const f = elStub({
    "GET /v1/voices/voiceX": [200, { voice_id: "voiceX" }],
    "PATCH /v1/convai/agents/agentX": [200, {}],
    "GET /v1/convai/conversation/token": [200, { token: "t3" }],
  }, calls);
  const r = await mintContender(EL_REQ, { openAiKey: "k", geminiKey: "", elevenLabsKey: EL_KEY, elevenLabsVoiceId: "voiceX", elevenLabsAgentId: "agentX" }, f);
  assertEquals(r.status, 200);
  assertEquals(calls.length, 3);
  const patch = JSON.parse(String(calls.find((c) => c.init.method === "PATCH")!.init.body));
  assertEquals(patch.conversation_config.tts.voice_id, "voiceX");
  assertEquals(buildAgentConfig("i", "voiceX").conversation_config.tts.voice_id, "voiceX");
});

Deno.test("elevenlabs: missing voice -> clear step error, never designs a replacement", async () => {
  for (const code of [404, 400]) {
    const calls: Call[] = [];
    const f = elStub({ [`GET ${MV}`]: [code, { detail: "SECRET-PROVIDER-FIELD voice_not_found" }] }, calls);
    const r = await mintContender(EL_REQ, { openAiKey: "k", geminiKey: "", elevenLabsKey: EL_KEY }, f);
    assertEquals(r.status, 502);
    assertEquals(r.body, { error: "This contender could not start.", status: code, step: "voice_not_found" });
    assertEquals(calls.length, 1);
    assertFalse(calls.some((c) => c.url.includes("text-to-voice")));
  }
  // a 200 for a different voice is also "not found"
  const f2 = elStub({ [`GET ${MV}`]: [200, { voice_id: "someone-else" }] }, []);
  const r2 = await mintContender(EL_REQ, { openAiKey: "k", geminiKey: "", elevenLabsKey: EL_KEY }, f2);
  assertEquals(r2.body, { error: "This contender could not start.", status: 200, step: "voice_not_found" });
});

Deno.test("elevenlabs: refusal reports only step and status, never the provider body", async () => {
  const calls: Call[] = [];
  const f = elStub({ [`GET ${MV}`]: [401, { detail: "SECRET-PROVIDER-FIELD invalid key" }] }, calls);
  const r = await mintContender(EL_REQ, { openAiKey: "k", geminiKey: "", elevenLabsKey: EL_KEY }, f);
  assertEquals(r.status, 502);
  assertEquals(r.body, { error: "This contender could not start.", status: 401, step: "voice_check" });
  const f2 = elStub({
    [`GET ${MV}`]: [200, { voice_id: MARTY_VOICE_ID }],
    "GET /v1/convai/agents": [200, { agents: [{ agent_id: "agent1", name: MARTY_AGENT_NAME }] }],
    "PATCH /v1/convai/agents/agent1": [200, {}],
    "GET /v1/convai/conversation/token": [200, { nope: true }],
  }, []);
  const r2 = await mintContender(EL_REQ, { openAiKey: "k", geminiKey: "", elevenLabsKey: EL_KEY }, f2);
  assertEquals(r2.body, { error: "This contender could not start.", status: 200, step: "token" });
});

Deno.test("elevenlabs: picking current voice leaves contender A exactly as before", async () => {
  const calls: Call[] = [];
  const f = elStub({ "POST /v1/realtime/client_secrets": [200, { value: "ek", expires_at: 1795000000 }] }, calls);
  const r = await mintContender({ contender: "A", mode: "push_to_talk", reveal: false, voice: "current" }, { openAiKey: "k", geminiKey: "", elevenLabsKey: EL_KEY }, f);
  assertEquals(r.status, 200);
  assertEquals(r.body.provider, "openai_realtime");
  assertEquals(calls.length, 1);
  assertFalse(calls.some((c) => c.url.includes("elevenlabs")));
});

Deno.test("elevenlabs: server reads the key only from ELEVENLABS_API_KEY", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(src.includes('Deno.env.get("ELEVENLABS_API_KEY")'));
  const lib = await Deno.readTextFile(new URL("./_shared/elevenlabs.ts", import.meta.url));
  assertFalse(lib.includes("Deno.env"));
  assertFalse(/console\./.test(lib));
  // no voice design or save path left in the server
  assertFalse(lib.includes("text-to-voice"));
});
