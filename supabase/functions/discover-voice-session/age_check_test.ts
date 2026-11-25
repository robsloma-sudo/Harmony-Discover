// 21+ age check (P-20261125-2244 part 2): no field or false -> "age check needed" and no session; true -> as today.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { AGE_CHECK_ERROR, AGE_CHECK_STATUS, ageCheckRequired, ageGate } from "./_shared/ageCheck.ts";
import { parseVoiceRequest } from "./_shared/voiceRequest.ts";
import { MARTY_BOSTON_CONSENT_VERSION } from "./_shared/martySullivanBoston.ts";

const OK = { consentVersion: MARTY_BOSTON_CONSENT_VERSION, mode: "push_to_talk" };

Deno.test("age: request shape accepts the field; only a real boolean is valid", () => {
  const none = parseVoiceRequest(OK);
  assert(none.ok && none.ageConfirmed === false);
  const no = parseVoiceRequest({ ...OK, age_confirmed: false });
  assert(no.ok && no.ageConfirmed === false);
  const yes = parseVoiceRequest({ ...OK, age_confirmed: true });
  assert(yes.ok && yes.ageConfirmed === true);
  assertFalse(parseVoiceRequest({ ...OK, age_confirmed: "true" }).ok);
  assertFalse(parseVoiceRequest({ ...OK, age_confirmed: 1 }).ok);
  assertFalse(parseVoiceRequest({ ...OK, ageConfirmed: true }).ok); // only the agreed name
});

Deno.test("age: no field or false gives the calm age-check error; true goes ahead", () => {
  for (const env of [undefined, "", "on", "ON"]) {
    assertEquals(ageGate(undefined, env), { status: AGE_CHECK_STATUS, body: AGE_CHECK_ERROR });
    assertEquals(ageGate(false, env), { status: 403, body: AGE_CHECK_ERROR });
    assertEquals(ageGate("true", env)?.status, 403);
    assertEquals(ageGate(true, env), null);
  }
  assertEquals(AGE_CHECK_ERROR.code, "age_check_needed");
  assert(AGE_CHECK_ERROR.error.startsWith("Age check needed."));
});

Deno.test("age: MARTY_AGE_CHECK=off (any case) is the only way to skip it", () => {
  assert(ageCheckRequired(undefined));
  assert(ageCheckRequired("on"));
  assertFalse(ageCheckRequired("off"));
  assertFalse(ageCheckRequired(" OFF "));
  assertEquals(ageGate(undefined, "off"), null);
});

// The server program itself: the age check must sit before the rate limit, memory load and the paid provider call.
Deno.test("age: voice program refuses before any paid session is started", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const gate = src.indexOf("ageGate(parsed.ageConfirmed");
  assert(gate > 0);
  assert(src.indexOf("if (ageBlock) return json(ageBlock.body, ageBlock.status, origin);") > gate);
  for (const later of ["authorizeGuest(supabaseUrl, anonKey, serviceKey, token, origin);\n    if (\"error\" in guest) return guest.error;\n    const { user",
                       "consume_marty_voice_rate_limit", "realtime/client_secrets", "buildRealtimeSession({"]) {
    const at = src.indexOf(later);
    assert(at > gate, `${later} must come after the age check`);
  }
});
