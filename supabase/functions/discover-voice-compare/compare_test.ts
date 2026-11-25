import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  buildGeminiTokenBody, buildGptLiveSession, compareAllowed, DEFAULT_ORDER, GEMINI_AUTH_TOKENS_URL,
  MARTY_BOSTON_CONSENT_VERSION, mintContender, parseCompareRequest, parseOrder, resolveContender,
} from "./_shared/compare.ts";
import { DEPLOY_FILES } from "./_shared/compare.ts";
import {
  buildRealtimeSession, DISCOVER_NAVIGATION_TOOLS, MARTY_LOOKUP_INSTRUCTIONS, MARTY_LOOKUP_TOOLS,
} from "../discover-voice-session/_shared/realtimeSession.ts";
import { martyCharacterBook } from "../discover-voice-session/_shared/martyCharacterBook.ts";

const UID = "11111111-2222-3333-4444-555555555555";
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

Deno.test("gpt-live-1: same instructions + nav tools, no unsupported fields", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const r = await mintContender({ contender: "B", mode: "hands_free", reveal: true }, env, stub(200, OPENAI_OK, calls));
  assertEquals(r.body.connectHint, "live");
  assertEquals(r.body.model, "gpt-live-1");
  assertEquals(r.body.voice, "marin");
  const s = JSON.parse(calls[0].init.body as string).session;
  assertEquals(Object.keys(s).sort(), ["audio", "instructions", "model", "tools", "type"]);
  assertEquals(s.tools, JSON.parse(JSON.stringify(DISCOVER_NAVIGATION_TOOLS)));
  assertEquals(s.tools.length, 2);
  assertEquals(s.audio, { output: { voice: "marin" } });
  assert(s.instructions.includes("HARMONY DISCOVER NAVIGATION"));
  const direct = buildGptLiveSession("hello");
  assertEquals(direct.instructions, "hello");
  for (const k of ["max_output_tokens", "speed", "turn_detection", "output_modalities"]) assertFalse(JSON.stringify(direct).includes(k));
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
    const r = await mintContender({ contender: letter, mode: "push_to_talk", reveal: true }, env,
      stub(400, { error: { message: "SECRET-PROVIDER-BODY sk-secret gk-secret" } }));
    assertEquals(r.status, 502);
    assertEquals(r.body, { error: "This contender could not start.", status: 400 });
    assertFalse(JSON.stringify(r).includes("SECRET"));
  }
  const thrown = await mintContender({ contender: "B", mode: "push_to_talk", reveal: false }, env,
    () => Promise.reject(new Error("boom sk-secret")));
  assertEquals(thrown, { status: 502, body: { error: "This contender could not start.", status: 0 } });
});

Deno.test("custom order moves the models", async () => {
  const r = await mintContender({ contender: "A", mode: "push_to_talk", reveal: true },
    { ...env, orderEnv: "gpt-live-1,gemini,current" }, stub(200, OPENAI_OK));
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
      const payload = letter === "C" ? { name: "t" } : OPENAI_OK;
      const r = await mintContender({ contender: letter, mode, reveal: false }, env, stub(200, payload, calls));
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
