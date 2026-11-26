import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { GONE_BODY, goneResponse } from "./index.ts";

const SITE = "https://harmony-discover.netlify.app";

Deno.test("listening test is gone: every start answers 410 gone", async () => {
  for (const body of ["{}", JSON.stringify({ contender: "A", mode: "push_to_talk", voice: "elevenlabs" }), "not json"]) {
    const res = goneResponse(new Request("https://x/functions/v1/discover-voice-compare", {
      method: "POST", headers: { Origin: SITE, Authorization: "Bearer fake", "Content-Type": "application/json" }, body,
    }));
    assertEquals(res.status, 410);
    assertEquals(await res.json(), GONE_BODY);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), SITE);
  }
  const get = goneResponse(new Request("https://x/", { method: "GET" }));
  assertEquals(get.status, 410);
  assertEquals((await get.json()).code, "gone");
});

Deno.test("listening test is gone: preflight still answers, foreign sites get no CORS", () => {
  assertEquals(goneResponse(new Request("https://x/", { method: "OPTIONS", headers: { Origin: SITE } })).status, 204);
  const foreign = goneResponse(new Request("https://x/", { method: "POST", headers: { Origin: "https://evil.example" } }));
  assertEquals(foreign.status, 410);
  assertEquals(foreign.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("listening test is gone: the stub reads no secrets and calls nothing", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  for (const banned of ["Deno.env", "fetch(", "createClient", "import ", "api.openai.com", "elevenlabs.io", "MARTY_COMPARE"]) {
    assertFalse(code.includes(banned), banned);
  }
  assert(code.includes("410"));
  assert(code.includes("Deno.serve(goneResponse)"), "starts plainly like our other programs");
  assertFalse(code.includes("import.meta.main"), "no import.meta.main guard");
});
