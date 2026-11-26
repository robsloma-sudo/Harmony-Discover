# discover-voice-compare

A listening test only. It lets Rob hear today's Marty (`gpt-realtime-2.1`) next to OpenAI's newer `gpt-live-1` and, if a key is set, Google's `gemini-3.8-live`, blind, before anything switches. Nothing switches by itself. `discover-voice-session` is not touched. DEV only.

Every contender gets the identical Marty script, built by `buildRealtimeSession` in `discover-voice-session/_shared` (imported read-only) exactly as `discover-voice-session/index.ts` builds it: the same character book (`martyCharacterBook`, passed as `characterBook`), with look-ups switched off (`lookupsEnabled: false`). So the script carries no look-up instructions and every OpenAI contender gets only the 2 navigation tools (Gemini gets no tools).

**Voice B (`gpt-live-1`) is relayed by this program.** GPT-Live does not hand out browser session passes. The app sends its WebRTC offer (`sdp`) here; this program forwards it with the server key to OpenAI's live sessions address (`POST https://api.openai.com/v1/live/sessions`, JSON `{ session, transport: { type: "webrtc", sdp } }`) and returns only OpenAI's SDP answer and the opaque session id. The key never leaves the server. Same Rob-only switch and list, same consent check and the same 4-per-minute limit, which is counted before any call to OpenAI. The compared Marty is the real Marty minus the look-ups this test has no relay for, and is never told about a tool he cannot use. `compare_test.ts` proves this for A, B and C in both modes.

## Who can use it

Off unless the server secret `MARTY_COMPARE` is exactly `on` AND the signed-in user's id is in `MARTY_COMPARE_USERS`. Anyone else (guests, other users, no sign-in) gets `404 {"error":"Not found."}`. Same DEV-only guard, CORS/origin rule, auth, active voice consent and the existing per-person voice limit (`consume_marty_voice_rate_limit`, 4 per minute) as `discover-voice-session`. No tables, no migrations; the only write is that existing per-minute counter. Tokens, keys and user ids are never logged.

## Secrets

- `MARTY_COMPARE`: `on` to enable. Unset (or anything else) switches the whole test off.
- `MARTY_COMPARE_USERS`: comma-separated user uuids allowed (Rob).
- `MARTY_COMPARE_ORDER` (optional): which model each letter is, default `current,gpt-live-1,gemini` (A,B,C). Invalid values fall back to the default.
- `GEMINI_API_KEY` (optional): without it contender `gemini` returns `503 {"error":"Contender not configured."}`.
- Reused: `OPENAI_API_KEY`, `MARTY_VOICE`, `MARTY_HANDS_FREE`, `DISCOVER_ALLOWED_ORIGINS`.

## Request (POST JSON, max 16384 bytes)

`{ consentVersion, contender: "A"|"B"|"C", mode: "push_to_talk"|"hands_free", reveal?: boolean, sdp?: string }`. Any other key returns 400. `sdp` is the app's WebRTC offer (text starting `v=0`, max 12000 bytes); it is used only for the GPT-Live contender and ignored by the others. If the GPT-Live contender is asked for without an offer: `400 {"error":"This contender needs a connection offer.","needsOffer":true}`, before any call to OpenAI. Simplest for the app: always send a fresh offer.

## Response (200)

Today's Marty: `{ contender, provider: "openai_realtime", ephemeralToken, expiresAt, transport: "webrtc", connectHint: "realtime", voice, model? }` (unchanged).
GPT-Live: `{ contender, provider: "openai_live", transport: "webrtc_relay", sdpAnswer, sessionId?, model? }`. The app sets `sdpAnswer` as the remote description; events use the `oai-events` data channel.
Gemini: `{ contender, provider: "gemini_live", ephemeralToken, transport: "websocket", model? }`.
`model` appears only when the request has `reveal: true`. If a provider refuses: `502 {"error":"This contender could not start.","status":<provider status code>}` (code only, never the provider body), so the test tells us what to correct.

## The app's job (separate work)

A hidden, Rob-only test screen: buttons A / B / C, the same 5 test lines read aloud to each, a 1-5 score per contender saved on the phone only. Reveal after scoring.

## Unconfirmed (could not be read; each is one line in `_shared/compare.ts`)

- `gpt-live-1` relay. Confirmed from OpenAI's GPT-Live WebRTC guide (developers.openai.com/api/docs/guides/voice-webrtc?api=live, partly readable): server relays the offer, path `/v1/live/sessions`, JSON body with `session` and `transport: { type: "webrtc", sdp }`, answer in `transport.sdp` with a session id (201). Not confirmed: host `api.openai.com`, Bearer auth, function tools at the top level of the live session (`GPT_LIVE_SEND_NAV_TOOLS`), and no voice field (the guide sets none, so the default voice is used). The model id may be `gpt-live-1.1` in newer examples. Each is one line in `_shared/compare.ts`.
- Gemini (ephemeral-tokens page unreadable): model id `gemini-3.8-live`, `v1alpha/auth_tokens` URL and body shape, token in the `name` field.

## ElevenLabs Boston voice (P-20261126-0004 part 1, Rob only)

An extra option in this same hidden test: Marty with an ORIGINAL ElevenLabs Boston voice, so Rob can compare it by ear with today's voice. ElevenLabs' official API only (`api.elevenlabs.io`, their Agents live-conversation service). The voice is designed from a text description (`MARTY_VOICE_DESCRIPTION` in `_shared/elevenlabs.ts`): gruff, older, working-class Boston bartender, thick Boston accent with dropped Rs, raspy, impatient, not based on any real person. No voice-clone address is ever called and no reference audio is ever sent (`elevenlabs_test.ts` checks this). Guest Marty (`discover-voice-session`) is not touched.

Same gate as the rest of this test, in the same order: switch on, signed in, on Rob's list, 21+ (`age_confirmed: true`), then the key check, then consent and the 4-per-minute limit, then ElevenLabs. Everyone else still gets 404.

**New request field:** `voice`: `"current"` (default when left out: today's flow, byte-for-byte the same) or `"elevenlabs"`. With `voice: "elevenlabs"`, `contender` is optional (any letter is echoed back) and two setup fields are accepted: `setup`: `"design_voice" | "save_voice" | "create_agent"`, and `generatedVoiceId` (only with `save_voice`). Sending `setup` or `generatedVoiceId` with today's voice returns 400.

**Missing key:** with `voice: "elevenlabs"` and no `ELEVENLABS_API_KEY`: `503 {"error":"ElevenLabs key not set"}`, before consent look-up, rate-limit count or any call out. Nothing else changes.

**One-time setup (after the key exists):**
1. `setup: "design_voice"` returns up to 3 previews `{ generatedVoiceId, audioBase64, mediaType }` reading `MARTY_PREVIEW_TEXT`. Rob listens and picks one.
2. `setup: "save_voice", generatedVoiceId` saves it in Rob's ElevenLabs voice library and returns `voiceId`. Store it as the server setting `ELEVENLABS_VOICE_ID` (a function secret; a voice id is not secret but lives with the other settings).
3. `setup: "create_agent"` creates a private ElevenLabs agent (signed-in tokens only, prompt and voice overrides allowed) with today's Marty script and that voice; returns `agentId`. Store it as `ELEVENLABS_AGENT_ID`.

**Live session (no `setup`):** `{ contender, provider: "elevenlabs_agents", voice: "elevenlabs", conversationToken, transport: "webrtc", overrides, model? }`. The app starts the ElevenLabs conversation with the official ElevenLabs browser SDK using `conversationToken` and passes `overrides` as given. `overrides.agent.prompt.prompt` is today's Marty script built by the same `buildCurrent` call as voice A (same character book, rules, hard limits, look-ups off); `overrides.tts.voiceId` is the designed voice. `model` only with `reveal: true`. Missing settings: `503 {"error":"ElevenLabs voice not set"}` / `{"error":"ElevenLabs agent not set"}`. Provider refusal: `502` with the status code only. No navigation tools on this voice (like Gemini).

**Honest difference:** ElevenLabs runs listen, think, speak in three steps. The words Marty is given are identical, but the thinking model is the one ElevenLabs runs (`ELEVENLABS_LLM`, default `gpt-4.1`) instead of OpenAI's speech-to-speech model, so wit may differ slightly as well as the voice.

**Secrets:** `ELEVENLABS_API_KEY` (Rob creates at elevenlabs.io/app/settings/api-keys; paste only into Supabase, Discover DEV project, Edge Functions, Secrets), `ELEVENLABS_VOICE_ID`, `ELEVENLABS_AGENT_ID`.

**Unconfirmed** (ElevenLabs create-agent and overrides pages could not be read; each is one line in `_shared/elevenlabs.ts`): create-agent field names, `platform_settings.overrides` shape, LLM id `gpt-4.1`, speaking model `eleven_flash_v2`, override shape `{ agent: { prompt: { prompt } }, tts: { voiceId } }` in the browser SDK. Confirmed from ElevenLabs docs: voice design `POST /v1/text-to-voice/design` (`voice_description`, `model_id` `eleven_ttv_v3`, `text` 100-1000 chars, previews with `generated_voice_id` and `audio_base_64`), save `POST /v1/text-to-voice` (`voice_name`, `voice_description`, `generated_voice_id`, returns `voice_id`), token `GET /v1/convai/conversation/token?agent_id=` with `xi-api-key`, returns `token`.

**Undo:** unset `ELEVENLABS_API_KEY` (instant: the option answers "ElevenLabs key not set") or unset `MARTY_COMPARE` (whole test off). The designed voice and agent can be deleted in the ElevenLabs dashboard.

## Deploy

This function imports Marty's shared script files read-only, so the deploy must carry these 7 files (paths under `supabase/functions/`), listed in `DEPLOY_FILES` in `_shared/compare.ts`; a test walks the real imports and fails if the list misses one:

- `discover-voice-compare/index.ts` (entry point), `discover-voice-compare/_shared/compare.ts`, `discover-voice-compare/_shared/elevenlabs.ts`
- `discover-voice-session/_shared/realtimeSession.ts`, `martySullivanBoston.ts`, `martyDelivery.ts`, `screenContext.ts`, `martyCharacterBook.ts`

With the Supabase CLI (`supabase functions deploy discover-voice-compare`) the relative imports are bundled automatically. With a file-list deploy tool, send all 7 with these relative paths. It needs the Marty look-up switch and character book code (PRs #139 and #141), so it deploys only after those.

## Switch off / undo

Unset `MARTY_COMPARE` (instant, all callers get 404), or delete the function. Nothing else depends on it; guests are never affected.

## Tests

`deno test --no-lock --no-config --import-map <shim> compare_test.ts` (pure, fetch stubbed). Real audio cannot be proven before deploy (the OpenAI key is only a DEV function secret): first post-approval checks are a DEV mint of each contender and Rob's ear test.
