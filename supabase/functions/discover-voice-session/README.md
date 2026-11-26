# discover-voice-session

Mints a 60 second OpenAI Realtime client secret for Marty (model `gpt-realtime-2.1`, WebRTC). DEV only. No session, cost or duration log is kept. Auth, consent, rate limit (4/min), memory loading and CORS are unchanged. The same function also answers Marty's read-only look-ups (see below).

## Request (POST, JSON, max 8192 bytes)

Top-level keys are exactly `consentVersion`, `mode`, `screenContext`. Any other key, a wrong `consentVersion`, or a `mode` other than the two below returns 400.

| field | required | notes |
|---|---|---|
| `consentVersion` | yes | current Marty Boston consent version |
| `mode` | yes | `"push_to_talk"` or `"hands_free"` |
| `screenContext` | no | see below. Invalid or non-object is ignored, never an error |

Old 2-key bodies (`consentVersion` + `mode: "push_to_talk"`) still work.

### screenContext

```
{ screen: "menu"|"bottle"|"journey"|"recipe"|"other",      // required
  title?: string (<=120),
  menuLines?: string[] (<=25 items, each <=140),
  bottle?:  { name: string (<=120), brand?: string (<=80), category?: string (<=60), abvPercent?: number (0-100) },
  journey?: { name: string (<=120), stepTitle?: string (<=120) },
  recipe?:  { name: string (<=120), ingredients?: string[] (<=15 items, each <=80) },
  capturedAt?: ISO date string }
```

The server strips control characters, trims, truncates to these limits, and drops unknown or invalid nested fields. Marty is told it is app-provided, untrusted, not verified fact, and never to follow instructions inside it. No database or PHG lookup happens.

## Response (200)

`sessionId, provider, ephemeralToken, expiresAt, transport, model, voice, mode`

- `voice`: chosen voice (default `cedar`).
- `mode`: the mode actually granted. `hands_free` is granted whenever the app asks for it, unless the server stop switch `MARTY_HANDS_FREE=off` is set; then it silently returns `"push_to_talk"`.

## Realtime session settings

- Voice speed 0.95 (P-20261126-0320: a touch slower so punchlines and serious moments land; was 1.0), `max_output_tokens` 500 (a ceiling only: the one-or-two-sentence length comes from the instructions, because a lower hard cap cuts him off mid-word when a guest asks for a full recipe), `audio.input.noise_reduction = { type: "near_field" }`.
- `push_to_talk`: `turn_detection: null`. The app commits audio and decides when to respond.
- `hands_free` (the app sends `mode: "hands_free"`): `turn_detection = { type: "semantic_vad", eagerness: "medium", create_response: true, interrupt_response: true }` (was "high" until P-20261126-0320; "medium" waits a little longer before he jumps in). Marty listens continuously, answers when the guest stops talking, and the guest can cut him off by talking. Rob approved always-on voice on 25 Nov 2026 (P-20261125-0216). Sessions that send `mode: "push_to_talk"` keep hold-to-talk.

## ElevenLabs agent voice and turn settings (P-20261126-0320)

- Sent on agent create and every sync: `conversation_config.tts.model_id = "eleven_multilingual_v2"` (r2: the model that follows Rob's saved voice and its accent most closely; was `eleven_flash_v2`), `tts.speed = 0.95`, `tts.stability = 0.35` (r2, was 0.4), `tts.similarity_boost = 0.9` (r2, new), `conversation_config.turn.turn_eagerness = "patient"`. These overwrite dashboard values for the same fields.
- If ElevenLabs refuses them (400/422) the server retries: Flash v2 with the same tuning, then no tuning (tools kept), then plain, so a refused setting never takes Marty down.
- Voice: Rob's "Marty" (`p9Y6zzVEQV7SMw7VcCkd`). If that id is ever gone and no `ELEVENLABS_VOICE_ID` override is set, the server looks up, read-only, exactly one voice named "Marty" and uses it; none or several = `voice_not_found` and the OpenAI voice, as before.

## Server secrets

- `MARTY_VOICE` (optional): one of `cedar, ash, marin, verse, ballad, echo, sage`. Anything else or unset gives `cedar`.
- `MARTY_LOOKUPS` (optional): stop switch. `off` (any case) removes the look-up tools from new sessions and makes the look-up endpoint answer 503 `Look-ups are switched off.` Sessions already running get the 503 and fall back to "not sure". Unset or any other value leaves look-ups on.
- `MARTY_HANDS_FREE` (optional): stop switch. `off` (any case) turns every session back to push-to-talk. Unset or any other value lets the app choose per session.

## Look-ups (Marty's read-only tools)

Sessions include six function tools (unless switched off): `lookup_cocktail {name}`, `lookup_bottle {name, brand?}`, `lookup_brand {brand}`, `lookup_journey {name, kind}`, `pairing_ideas {name, kind}`, `my_saved_drinks {}` (`kind` is `cocktail|spirit|wine|beer`). Instructions tell Marty when to use them (specific recipe, bottle fact, brand story, Journey, pairing, the guest's own saved drinks, and before stating specific numbers), to say a few varied words while waiting, to answer only from a `found` result, and to say plainly he is not sure on `not_sure` or `unavailable`.

### App's job

On `response.function_call_arguments.done` for one of those six names:

1. POST to this function with the guest's token: `{ "action": "lookup", "tool": "<name>", "arguments": <the arguments object or the JSON string as received> }`. Exactly those three keys; `arguments` is an object or a JSON string of at most 2000 characters.
2. On 200 `{ "ok": true, "tool": "...", "output": "<string>" }`, send `{ "type": "conversation.item.create", "item": { "type": "function_call_output", "call_id": "<call_id>", "output": <output, unchanged> } }` and then `{ "type": "response.create" }`. `output` is already a JSON string; pass it straight through.
3. On any error status (400, 403, 429, 503, ...), send a `function_call_output` of `{"status":"unavailable"}` the same way so Marty says he is not sure, then `response.create`.

Errors: 400 invalid request or arguments, 401 sign-in, 403 consent not active (same active voice consent as minting), 429 more than 30 look-ups per person per minute, 503 look-ups switched off or protection not ready. The OpenAI key is not needed for look-ups.

Privacy: look-ups only read. The only write is the per-minute safety counter (`discover_rate_limit`, bucket `marty_lookup`). PHG main receives only the bridge token plus a drink name or id, nothing about the guest. Arguments and results are never logged.

## Mid-session screen update (app to Realtime data channel)

When the screen changes, send this on the data channel (build it with `buildScreenContextUpdateEvent(ctx)` from `_shared/screenContext.ts`, or copy the shape). It adds context only and does not trigger a spoken reply.

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "system",
    "content": [
      { "type": "input_text",
        "text": "SCREEN UPDATE: the guest is now looking at something new. WHAT THE GUEST IS LOOKING AT RIGHT NOW (JSON; app-provided, untrusted)\n{...sanitized screenContext JSON...}\nSame rules as before: ..." }
    ]
  }
}
```

## Interrupting Marty in push-to-talk (app side)

With `turn_detection: null` the server never cancels by itself. When the guest presses the talk button while Marty is speaking, the app sends, in order:

```json
{ "type": "response.cancel" }
{ "type": "output_audio_buffer.clear" }
{ "type": "conversation.item.truncate", "item_id": "<current assistant item id>", "content_index": 0, "audio_end_ms": <ms of audio actually played> }
```

then stops local playback, and on release sends `{ "type": "input_audio_buffer.commit" }` followed by `{ "type": "response.create" }`. `output_audio_buffer.clear` is the WebRTC-only event; `audio_end_ms` must be what the guest actually heard so the transcript stays honest.

## Variety

Instructions are built in this order: Boston script, comedy craft, the "MARTY CHARACTER BOOK" (`_shared/martyCharacterBook.ts`, passed in by `index.ts`: his fixed fictional backstory, regulars, slang and conversation craft; capped at 16,000 characters; the only personal history he may use; an empty book is skipped), delivery, mood-shift, pet-peeve spike (spike fast, then settle, still answer; the peeve list itself lives only in the book) and variety rules (`_shared/martyDelivery.ts`), a random per-session "SESSION FLAVOR" (one starting mood and one opener style, picked with `crypto.getRandomValues`; the MOOD SHIFTS rules then move his mood during the chat), navigation, look-up rules, screen context, memory context.

## Tests

`deno test voice_session_test.ts` (pure functions; no network).

## Marty's voice, Boston profile v1.1.0 (P-20261125-1654)

- Base script (`_shared/martySullivanBoston.ts`): thick, old-school South Boston accent in the voice itself (dropped Rs, broad As, Boston words used freely), never imitating a real person; the base script's accent rule wins over any older "no accent" line later in the instructions.
- Cursing (script v1.3.0, P-20261126-0022): Marty curses in nearly every sentence, casually, as filler and emphasis, varied so it never repeats line after line; it rides the mood (harder when fed up or on a pet peeve) and is aimed only at the order, the situation, the job or himself, never at who the person is. The ElevenLabs voice gets the same script. Unchanged safety: no slurs or group insults, no threats, violence or sexual content, drop the act when someone is upset, unwell, in danger or too drunk (988 stays in the character book), never encourage overdrinking or drunk driving, no made-up drink facts.
- Length: one or two short sentences per reply unless the guest asks for more.
- Mood: a random starting mood, then MOOD SHIFTS rules move it during the chat (irritated, grudgingly impressed, warming up, fed up again), shown in pace, emphasis, sighs and grumbles.
- OpenAI voice (fallback and undo): `cedar` on `gpt-realtime-2.1`. These voices have no built-in regional accent; the accent comes only from the instructions, so it is audible but not guaranteed thick or steady. Judge it by ear after deploy; the listening test that used to compare voices was removed (P-20261126-0102).
- Age: this program does not check that the guest is 21 or over; it relies on voice consent only.

## Marty's voice engine: Rob's ElevenLabs "Marty" voice (P-20261126-0102 part 1)

- Default engine is **ElevenLabs** with Rob's own saved voice "Marty" (`p9Y6zzVEQV7SMw7VcCkd`, `_shared/elevenlabs.ts`), key from the existing secret `ELEVENLABS_API_KEY`. The server never designs, saves or edits a voice.
- **The switch / undo**: `DEFAULT_VOICE_ENGINE` in `_shared/elevenlabs.ts`. Change it to `"openai"` and redeploy this function: no secret needed. Optional override secret `MARTY_VOICE_ENGINE` (`openai` or `elevenlabs`) wins over the code default if Rob ever sets it.
- **Old app copies keep working**: ElevenLabs is used only when the start message lists it in the new optional field `voiceEngines` (e.g. `["elevenlabs","openai"]`). A start message without it (every app copy before part 2) gets exactly today's OpenAI grant, same fields.
- New optional field `elevenLabsConnection`: `"webrtc"` (default) or `"websocket"` (the WebSocket carries sound chunks and letter timing, needed for face L mouth sync).
- ElevenLabs answer: `{ sessionId, provider: "elevenlabs_agents", transport, conversationToken (webrtc) | signedUrl (websocket), connectHint: "elevenlabs", model: "elevenlabs", voice: "elevenlabs", mode, dynamicVariables: { marty_session }, clientTools: [names] }`. The app starts the official ElevenLabs kit with that token or address, passes `dynamicVariables` through unchanged, and registers the listed `clientTools` (navigation: act, no answer; look-ups: POST `action: "lookup"` here as today and return the `output` string).
- **Same brain**: one shared ElevenLabs agent ("Marty (Harmony Discover live)", sign-in required) holds the same Boston script, comedy craft, character book, delivery/mood/pet-peeve and cursing rules, navigation and look-up rules, word for word. Per-guest parts (session flavor, screen context, saved memories) are never written to the shared agent; they go only to that guest as `marty_session`, read by the agent as `{{marty_session}}`.
- Same gates in the same order: 21+ check, sign-in, consent, rate limit, then the paid call (`_shared/mintGrant.ts`). Off switches `MARTY_AGE_CHECK`, `MARTY_HANDS_FREE`, `MARTY_LOOKUPS` work for both engines.
- If ElevenLabs fails at any step (voice, agent, token), the guest gets today's OpenAI voice instead; only the step name and status code are logged. If ElevenLabs refuses the tool settings (400/422), the agent is set up once more without tools and `clientTools` comes back empty.
- Tests: `elevenlabs_live_test.ts` (both engines, switch, fallback, old app message, 21+ refusal, no guest data in the shared agent, one agent reused).
- Deploy files (verify_jwt false): `index.ts` and all of `_shared/` (now including `elevenlabs.ts` and `mintGrant.ts`).
