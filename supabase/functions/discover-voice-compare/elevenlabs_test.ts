// ElevenLabs option for the listening test (P-20261126-0004 part 1). Pure: fetch stubbed, no key, no network.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
  buildCurrent, compareAllowed, MARTY_BOSTON_CONSENT_VERSION, mintContender, OPENAI_CLIENT_SECRETS_URL, parseCompareRequest,
} from "./_shared/compare.ts";
import {
  buildAgentBody, buildSaveVoiceBody, buildVoiceDesignBody, ELEVENLABS_API, ELEVENLABS_CREATE_AGENT_URL, ELEVENLABS_DESIGN_URL,
  ELEVENLABS_KEY_MISSING, ELEVENLABS_SAVE_VOICE_URL, ELEVENLABS_TOKEN_URL, MARTY_PREVIEW_TEXT, MARTY_VOICE_DESCRIPTION,
  runElevenLabs,
} from "./_shared/elevenlabs.ts";
import { martyCharacterBook } from "../discover-voice-session/_shared/martyCharacterBook.ts";
import { martyBostonInstructions } from "../discover-voice-session/_shared/martySullivanBoston.ts";

const OK = { consentVersion: MARTY_BOSTON_CONSENT_VERSION, contender: "A", mode: "push_to_talk" };
const EL = { consentVersion: MARTY_BOSTON_CONSENT_VERSION, voice: "elevenlabs", mode: "hands_free" };
type Call = { url: string; init: RequestInit };
function stub(status: number, payload: unknown, calls: Call[] = []) {
  return (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(payload), { status }));
  };
}
const ENV = { apiKey: "xi-secret", voiceId: "voice_ABC12345", agentId: "agent_XYZ98765" };
const instr = () => buildCurrent("hands_free", undefined, undefined).session.instructions;

Deno.test("default path unchanged: no voice field means today's voice, same call, same answer", async () => {
  const plain = parseCompareRequest(OK);
  const named = parseCompareRequest({ ...OK, voice: "current" });
  assert(plain.ok && named.ok);
  assertEquals(plain, named);
  assert(plain.ok && plain.voice === "current");
  const calls: Call[] = [];
  const env = { openAiKey: "sk-secret", geminiKey: "", voiceEnv: undefined, handsFreeEnv: undefined };
  const r = await mintContender(plain as { contender: "A"; mode: "push_to_talk"; reveal: false }, env,
    stub(200, { value: "ek_test", expires_at: 1800000000 }, calls));
  assertEquals(r.status, 200);
  assertEquals(r.body.provider, "openai_realtime");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, OPENAI_CLIENT_SECRETS_URL);
  assertFalse(calls.some((c) => c.url.startsWith(ELEVENLABS_API)));
});

Deno.test("request: exact field name and values", () => {
  assert(parseCompareRequest(EL).ok);
  assert(parseCompareRequest({ ...EL, contender: "B", reveal: true, age_confirmed: true }).ok);
  assertFalse(parseCompareRequest({ ...EL, voice: "ElevenLabs" }).ok);
  assertFalse(parseCompareRequest({ ...EL, voice: "other" }).ok);
  assertFalse(parseCompareRequest({ ...EL, contender: "D" }).ok);
  assertFalse(parseCompareRequest({ ...OK, contender: undefined }).ok); // today's voice still needs a contender
  // setup steps only with voice elevenlabs; generatedVoiceId only with save_voice
  assert(parseCompareRequest({ ...EL, setup: "design_voice" }).ok);
  assert(parseCompareRequest({ ...EL, setup: "create_agent" }).ok);
  const save = parseCompareRequest({ ...EL, setup: "save_voice", generatedVoiceId: "gen_12345678" });
  assert(save.ok && save.voice === "elevenlabs" && save.generatedVoiceId === "gen_12345678");
  assertFalse(parseCompareRequest({ ...OK, setup: "design_voice" }).ok);
  assertFalse(parseCompareRequest({ ...EL, setup: "clone_voice" }).ok);
  assertFalse(parseCompareRequest({ ...EL, setup: "design_voice", generatedVoiceId: "gen_12345678" }).ok);
  assertFalse(parseCompareRequest({ ...EL, setup: "save_voice", generatedVoiceId: "bad id!" }).ok);
});

Deno.test("guests cannot reach it: gate, sign-in and 21+ check all come first", async () => {
  assertFalse(compareAllowed(undefined, "u1", "u1"));
  assertFalse(compareAllowed("on", "rob", "guest"));
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const order = [
    'Deno.env.get("MARTY_COMPARE") !== "on"', "auth.getUser(token)", "compareAllowed(", "ageGate(parsed.ageConfirmed",
    'parsed.voice === "elevenlabs" && !elevenLabsKey', 'from("bartender_voice_consents")', "consume_marty_voice_rate_limit",
    "runElevenLabs(parsed", "mintContender(parsed",
  ];
  let last = -1;
  for (const step of order) {
    const at = src.indexOf(step);
    assert(at > last, `${step} is out of order`);
    last = at;
  }
  // guest Marty is not touched: discover-voice-session never mentions ElevenLabs
  const guest = await Deno.readTextFile(new URL("../discover-voice-session/index.ts", import.meta.url));
  assertFalse(guest.toLowerCase().includes("elevenlabs"));
});

Deno.test("missing key: plain answer, no call out", async () => {
  assertEquals(ELEVENLABS_KEY_MISSING, { error: "ElevenLabs key not set" });
  const calls: Call[] = [];
  for (const setup of [undefined, "design_voice", "save_voice", "create_agent"] as const) {
    const r = await runElevenLabs({ mode: "hands_free", reveal: false, setup, generatedVoiceId: "gen_12345678" },
      { ...ENV, apiKey: "" }, instr, stub(200, {}, calls));
    assertEquals(r.status, 503);
    assertEquals(r.body, { error: "ElevenLabs key not set" });
  }
  assertEquals(calls.length, 0);
});

Deno.test("same character book and script in both paths", async () => {
  const current = buildCurrent("hands_free", undefined, undefined).session.instructions;
  const calls: Call[] = [];
  const r = await runElevenLabs({ mode: "hands_free", reveal: false }, ENV, instr, stub(200, { token: "tok_1" }, calls));
  assertEquals(r.status, 200);
  const sent = (r.body.overrides as { agent: { prompt: { prompt: string } } }).agent.prompt.prompt;
  for (const text of [sent, current]) {
    assert(text.startsWith(martyBostonInstructions));
    assert(text.includes(`MARTY CHARACTER BOOK\n${martyCharacterBook.trim()}\n`));
  }
  // flavor line is random per build, so everything up to the book end must match exactly
  const cut = (t: string) => t.slice(0, t.indexOf(martyCharacterBook.trim()) + martyCharacterBook.trim().length);
  assertEquals(cut(sent), cut(current));
  const agent = buildAgentBody(ENV.voiceId, current);
  assertEquals(agent.conversation_config.agent.prompt.prompt, current);
});

Deno.test("live session: private token, key never returned", async () => {
  const calls: Call[] = [];
  const r = await runElevenLabs({ contender: "C", mode: "push_to_talk", reveal: false }, ENV, instr, stub(200, { token: "tok_1" }, calls));
  assertEquals(calls[0].url, `${ELEVENLABS_TOKEN_URL}?agent_id=agent_XYZ98765`);
  assertEquals(calls[0].init.method, "GET");
  assertEquals((calls[0].init.headers as Record<string, string>)["xi-api-key"], "xi-secret");
  assertEquals(r.body.provider, "elevenlabs_agents");
  assertEquals(r.body.conversationToken, "tok_1");
  assertEquals(r.body.contender, "C");
  assertFalse("model" in r.body);
  assertFalse(JSON.stringify(r.body).includes("xi-secret"));
  const bad = await runElevenLabs({ mode: "push_to_talk", reveal: false }, ENV, instr, stub(401, { detail: "SECRET-PROVIDER-BODY" }));
  assertEquals(bad.body, { error: "This contender could not start.", status: 401 });
  const noAgent = await runElevenLabs({ mode: "push_to_talk", reveal: false }, { ...ENV, agentId: "" }, instr, stub(200, {}));
  assertEquals(noAgent.body, { error: "ElevenLabs agent not set" });
  const noVoice = await runElevenLabs({ mode: "push_to_talk", reveal: false }, { ...ENV, voiceId: "" }, instr, stub(200, {}));
  assertEquals(noVoice.body, { error: "ElevenLabs voice not set" });
});

Deno.test("voice design: original voice from Rob's description, never cloned", async () => {
  const body = buildVoiceDesignBody();
  assert(MARTY_VOICE_DESCRIPTION.startsWith("Gruff, older, working-class Boston bartender"));
  assert(MARTY_VOICE_DESCRIPTION.includes("Thick Boston accent with dropped Rs, raspy, impatient"));
  assert(MARTY_VOICE_DESCRIPTION.includes("not based on or imitating any real person"));
  assert(MARTY_PREVIEW_TEXT.length >= 100 && MARTY_PREVIEW_TEXT.length <= 1000);
  assertFalse("reference_audio_base64" in body);
  const calls: Call[] = [];
  const previews = { previews: [{ generated_voice_id: "gen_12345678", audio_base_64: "AAAA", media_type: "audio/mpeg" }], text: "x" };
  const d = await runElevenLabs({ mode: "push_to_talk", reveal: false, setup: "design_voice" }, { ...ENV, voiceId: "", agentId: "" }, instr, stub(200, previews, calls));
  assertEquals(d.status, 200);
  assertEquals(calls[0].url, ELEVENLABS_DESIGN_URL);
  assertEquals(JSON.parse(calls[0].init.body as string), body);
  const s = await runElevenLabs({ mode: "push_to_talk", reveal: false, setup: "save_voice", generatedVoiceId: "gen_12345678" },
    { ...ENV, voiceId: "", agentId: "" }, instr, stub(200, { voice_id: "voice_NEW12345" }, calls));
  assertEquals(s.body.voiceId, "voice_NEW12345");
  assertEquals(calls[1].url, ELEVENLABS_SAVE_VOICE_URL);
  assertEquals(JSON.parse(calls[1].init.body as string), buildSaveVoiceBody("gen_12345678"));
  const a = await runElevenLabs({ mode: "push_to_talk", reveal: false, setup: "create_agent" }, { ...ENV, agentId: "" }, instr, stub(200, { agent_id: "agent_NEW1234" }, calls));
  assertEquals(a.body.agentId, "agent_NEW1234");
  assertEquals(calls[2].url, ELEVENLABS_CREATE_AGENT_URL);
  // the only ElevenLabs addresses this program can call; no clone (voices/add) or reference-audio route
  const src = await Deno.readTextFile(new URL("./_shared/elevenlabs.ts", import.meta.url));
  for (const banned of ["voices/add", "/ivc", "/pvc", "remix", "reference_audio_base64\":", "speech-to-speech"]) {
    assertFalse(src.includes(banned), banned);
  }
  assertEquals([...src.matchAll(/\$\{ELEVENLABS_API\}(\/[a-z0-9/_-]+)/g)].map((m) => m[1]).sort(),
    ["/v1/convai/agents/create", "/v1/convai/conversation/token", "/v1/text-to-voice", "/v1/text-to-voice/design"]);
});
