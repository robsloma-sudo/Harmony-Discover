# discover-voice-compare

A listening test only. It lets Rob hear today's Marty (`gpt-realtime-2.1`) next to OpenAI's newer `gpt-live-1` and, if a key is set, Google's `gemini-3.8-live`, blind, before anything switches. Nothing switches by itself. `discover-voice-session` is not touched. DEV only.

Every contender gets the identical Marty script, built by `buildRealtimeSession` in `discover-voice-session/_shared` (imported read-only) exactly as `discover-voice-session/index.ts` builds it: the same character book (`martyCharacterBook`, passed as `characterBook`), with look-ups switched off (`lookupsEnabled: false`). So the script carries no look-up instructions and every OpenAI contender gets only the 2 navigation tools (Gemini gets no tools). The compared Marty is the real Marty minus the look-ups this test has no relay for, and is never told about a tool he cannot use. `compare_test.ts` proves this for A, B and C in both modes.

## Who can use it

Off unless the server secret `MARTY_COMPARE` is exactly `on` AND the signed-in user's id is in `MARTY_COMPARE_USERS`. Anyone else (guests, other users, no sign-in) gets `404 {"error":"Not found."}`. Same DEV-only guard, CORS/origin rule, auth, active voice consent and the existing per-person voice limit (`consume_marty_voice_rate_limit`, 4 per minute) as `discover-voice-session`. No tables, no migrations; the only write is that existing per-minute counter. Tokens, keys and user ids are never logged.

## Secrets

- `MARTY_COMPARE`: `on` to enable. Unset (or anything else) switches the whole test off.
- `MARTY_COMPARE_USERS`: comma-separated user uuids allowed (Rob).
- `MARTY_COMPARE_ORDER` (optional): which model each letter is, default `current,gpt-live-1,gemini` (A,B,C). Invalid values fall back to the default.
- `GEMINI_API_KEY` (optional): without it contender `gemini` returns `503 {"error":"Contender not configured."}`.
- Reused: `OPENAI_API_KEY`, `MARTY_VOICE`, `MARTY_HANDS_FREE`, `DISCOVER_ALLOWED_ORIGINS`.

## Request (POST JSON, max 1024 bytes)

`{ consentVersion, contender: "A"|"B"|"C", mode: "push_to_talk"|"hands_free", reveal?: boolean }`. Any other key returns 400.

## Response (200)

OpenAI contenders: `{ contender, provider: "openai_realtime", ephemeralToken, expiresAt, transport: "webrtc", connectHint: "realtime"|"live", voice, model? }`. `connectHint` tells the app which OpenAI connection flow to use (`realtime` for today's model, `live` for `gpt-live-1`).
Gemini: `{ contender, provider: "gemini_live", ephemeralToken, transport: "websocket", model? }`.
`model` appears only when the request has `reveal: true`. If a provider refuses: `502 {"error":"This contender could not start.","status":<provider status code>}` (code only, never the provider body), so the test tells us what to correct.

## The app's job (separate work)

A hidden, Rob-only test screen: buttons A / B / C, the same 5 test lines read aloud to each, a 1-5 score per contender saved on the phone only. Reveal after scoring.

## Unconfirmed (could not be read; each is one line in `_shared/compare.ts`)

- `gpt-live-1` (OpenAI model page only, guide pages unreadable): id, function calling, default voice `marin` fixed per session, server-driven turns (no client `response.create`/`cancel`), WebRTC recommended, WebSocket `wss://api.openai.com/v1/live/sessions`, about $0.05/min plus backend model. We assume the same `client_secrets` endpoint accepts it and send only `type, model, instructions, tools, audio.output.voice`. Because turns are server-driven, hands-free vs push-to-talk may not behave as today.
- Gemini (ephemeral-tokens page unreadable): model id `gemini-3.8-live`, `v1alpha/auth_tokens` URL and body shape, token in the `name` field.

## Deploy

This function imports Marty's shared script files read-only, so the deploy must carry these 7 files (paths under `supabase/functions/`), listed in `DEPLOY_FILES` in `_shared/compare.ts`; a test walks the real imports and fails if the list misses one:

- `discover-voice-compare/index.ts` (entry point), `discover-voice-compare/_shared/compare.ts`
- `discover-voice-session/_shared/realtimeSession.ts`, `martySullivanBoston.ts`, `martyDelivery.ts`, `screenContext.ts`, `martyCharacterBook.ts`

With the Supabase CLI (`supabase functions deploy discover-voice-compare`) the relative imports are bundled automatically. With a file-list deploy tool, send all 7 with these relative paths. It needs the Marty look-up switch and character book code (PRs #139 and #141), so it deploys only after those.

## Switch off / undo

Unset `MARTY_COMPARE` (instant, all callers get 404), or delete the function. Nothing else depends on it; guests are never affected.

## Tests

`deno test --no-lock --no-config --import-map <shim> compare_test.ts` (pure, fetch stubbed). Real audio cannot be proven before deploy (the OpenAI key is only a DEV function secret): first post-approval checks are a DEV mint of each contender and Rob's ear test.
