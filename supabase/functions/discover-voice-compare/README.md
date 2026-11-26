# discover-voice-compare

A listening test only. It lets Rob hear today's Marty (`gpt-realtime-2.1`) next to OpenAI's newer `gpt-live-1` and, if a key is set, Google's `gemini-3.8-live`, blind, before anything switches. Nothing switches by itself. `discover-voice-session` is not touched. DEV only.

Every contender gets the identical Marty script, built by `buildRealtimeSession` in `discover-voice-session/_shared` (imported read-only) exactly as `discover-voice-session/index.ts` builds it: the same character book (`martyCharacterBook`, passed as `characterBook`), with look-ups switched off (`lookupsEnabled: false`). So the script carries no look-up instructions and every OpenAI contender gets only the 2 navigation tools (Gemini gets no tools).

**Voice B (`gpt-live-1`) is relayed by this program.** GPT-Live does not hand out browser session passes. The app sends its WebRTC offer (`sdp`) here; this program forwards it with the server key to OpenAI's live sessions address (`POST https://api.openai.com/v1/live/sessions`, JSON `{ session, transport: { type: "webrtc", sdp } }`) and returns only OpenAI's SDP answer and the opaque session id. The key never leaves the server. Same Rob-only switch and list, same consent check and the same 4-per-minute limit, which is counted before any call to OpenAI. The compared Marty is the real Marty minus the look-ups this test has no relay for, and is never told about a tool he cannot use. `compare_test.ts` proves this for A, B and C in both modes.

## ElevenLabs voice (P-20261126-0004 part 1)

Rob can pick **Current voice** (default) or **ElevenLabs voice** on the hidden test screen. With `voice: "elevenlabs"` the pressed letter is served by ElevenLabs' official Agents API (`api.elevenlabs.io`) instead: the same Marty script as every contender (same builder, same character book, look-ups off), spoken by Rob's own original ElevenLabs voice **"Marty"** (voice id `p9Y6zzVEQV7SMw7VcCkd`, category generated), which Rob designed and saved himself. The server never designs, saves or edits a voice on Rob's account. Code: `_shared/elevenlabs.ts`.

On each ElevenLabs start the server: checks that the Marty voice exists (`GET /v1/voices/{voice_id}`, read-only; if it is missing it stops with step `voice_not_found`, never designs a replacement); finds our agent by its exact name (or creates it); updates the agent with today's Marty script and that voice; then asks ElevenLabs for a one-conversation WebRTC token. The app gets only `{ contender, provider: "elevenlabs_agents", conversationToken, transport: "webrtc", connectHint: "elevenlabs", voice: "elevenlabs", model? }` and connects with the ElevenLabs client (`Conversation.startSession({ conversationToken, connectionType: "webrtc" })`). No navigation tools are given to the ElevenLabs agent (like Gemini).

- No key: `503 {"error":"ElevenLabs key not set."}`, before any call.
- A refusal: `502 {"error":"This contender could not start.","status":<code>,"step":"voice_not_found|voice_check|agent_list|agent_create|agent_update|token"}` (code and step only, never the provider body). `voice_not_found` means the voice id is not on the account behind the key; `voice_check` means the voice check itself was refused (for example 401, a bad key).
- Unconfirmed (pages not re-read): the `GET /v1/voices/{voice_id}` answer shape (`voice_id`), and agent create/update/list paths and body (`conversation_config.agent.prompt.prompt`, `agent.language`, `tts.voice_id`, `tts.model_id`). Each is one line in `_shared/elevenlabs.ts`; the `step` in a refusal says which one to fix.

## Who can use it

Off unless the server secret `MARTY_COMPARE` is exactly `on` AND the signed-in user's id is in `MARTY_COMPARE_USERS`. Anyone else (guests, other users, no sign-in) gets `404 {"error":"Not found."}`. Same DEV-only guard, CORS/origin rule, auth, active voice consent and the existing per-person voice limit (`consume_marty_voice_rate_limit`, 4 per minute) as `discover-voice-session`. No tables, no migrations; the only write is that existing per-minute counter. Tokens, keys and user ids are never logged.

## Secrets

- `MARTY_COMPARE`: `on` to enable. Unset (or anything else) switches the whole test off.
- `MARTY_COMPARE_USERS`: comma-separated user uuids allowed (Rob).
- `MARTY_COMPARE_ORDER` (optional): which model each letter is, default `current,gpt-live-1,gemini` (A,B,C). Invalid values fall back to the default.
- `GEMINI_API_KEY` (optional): without it contender `gemini` returns `503 {"error":"Contender not configured."}`.
- `ELEVENLABS_API_KEY`: Rob's ElevenLabs key, saved by Rob as an Edge Functions secret on Discover dev. Read only from this name; never in code, logs, chat or the PR. Without it the ElevenLabs voice answers "ElevenLabs key not set."
- `ELEVENLABS_VOICE_ID` (optional): overrides the default voice id (`p9Y6zzVEQV7SMw7VcCkd`, Rob's "Marty"). Unset is normal.
- `ELEVENLABS_AGENT_ID` (optional): pin the agent and skip the agent name look-up.
- `ELEVENLABS_LLM` (optional): ElevenLabs' thinking model for the agent; unset = ElevenLabs' default.
- Reused: `OPENAI_API_KEY`, `MARTY_VOICE`, `MARTY_HANDS_FREE`, `DISCOVER_ALLOWED_ORIGINS`.

## Request (POST JSON, max 16384 bytes)

`{ consentVersion, contender: "A"|"B"|"C", mode: "push_to_talk"|"hands_free", reveal?: boolean, sdp?: string, voice?: "current"|"elevenlabs", age_confirmed? }`. `voice` is optional; absent means `current`. Any other key returns 400. `sdp` is the app's WebRTC offer (text starting `v=0`, max 12000 bytes); it is used only for the GPT-Live contender and ignored by the others. If the GPT-Live contender is asked for without an offer: `400 {"error":"This contender needs a connection offer.","needsOffer":true}`, before any call to OpenAI. Simplest for the app: always send a fresh offer.

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

## Deploy

This function imports Marty's shared script files read-only, so the deploy must carry these 7 files (paths under `supabase/functions/`), listed in `DEPLOY_FILES` in `_shared/compare.ts`; a test walks the real imports and fails if the list misses one:

- `discover-voice-compare/index.ts` (entry point), `discover-voice-compare/_shared/compare.ts`
- `discover-voice-session/_shared/realtimeSession.ts`, `martySullivanBoston.ts`, `martyDelivery.ts`, `screenContext.ts`, `martyCharacterBook.ts`

With the Supabase CLI (`supabase functions deploy discover-voice-compare`) the relative imports are bundled automatically. With a file-list deploy tool, send all of them with these relative paths (now 9, including `discover-voice-compare/_shared/elevenlabs.ts` and `discover-voice-session/_shared/ageCheck.ts`). It needs the Marty look-up switch and character book code (PRs #139 and #141), so it deploys only after those.

## Switch off / undo

Unset `MARTY_COMPARE` (instant, all callers get 404), or delete the function. Nothing else depends on it; guests are never affected.

## Tests

`deno test --no-lock --no-config --import-map <shim> compare_test.ts` (pure, fetch stubbed). Real audio cannot be proven before deploy (the OpenAI key is only a DEV function secret): first post-approval checks are a DEV mint of each contender and Rob's ear test.

## Marty's face (P-20261126-0028 part 1, Rob-only preview)

Two new optional request fields. Both absent = exactly the old answer.

- `face`: `"phone"` (default, today's face L animated on the phone, option A) or `"photo"` (option B, photo-real face service).
- `connection`: `"webrtc"` (default) or `"websocket"`. Only changes the ElevenLabs voice.

### Option B: `face: "photo"`
Service: **Anam** (`api.anam.ai`), audio passthrough mode: Anam only draws the face, it never thinks or talks for Marty. Our own original face L image is uploaded once by Rob as an Anam custom (one-shot) avatar; no stock avatar or real person's face is ever used. Gates: same Rob-only switch, then 21+, then the face key check, all before the consent look-up, the rate limit and any paid call.

Secrets (Discover dev, Edge Functions secrets):
- `ANAM_API_KEY`: Rob's Anam key (lab.anam.ai, API keys). Missing = `503 {"error":"face service key not set"}`.
- `ANAM_AVATAR_ID`: the id of Rob's face L avatar in Anam (lab.anam.ai, Avatars, create from image). Missing = `503 {"error":"face not set up"}`.
- `ANAM_AVATAR_MODEL` (optional): avatar model, default `cara-4` (docs); `cara-4.1-express` is newer in Anam's changelog.

Answer (200): the normal voice answer plus
`face: { provider: "anam", sessionToken, audioInput: { encoding: "pcm_s16le", sampleRate: 16000, channels: 1 } }`.
If Anam refuses: `502 {"error":"The face could not start.","status":<code>,"step":"face_token"}` and no voice is started.

App (Discover app team): `createClient(face.sessionToken, { disableInputAudio: true })`, `streamToVideoElement(<video id>)`, `createAgentAudioInputStream(face.audioInput)`, then `sendAudioChunk(<Marty's PCM>)` as it arrives, `endSequence()` at the end of each Marty turn, `interruptPersona()` on Stop or barge-in. Anam buffers about 480 ms of audio before the first frame, so play Anam's own stream (muted original) to keep lips and sound together.
Where Marty's PCM comes from: today's voice = the OpenAI WebRTC audio track (tap it in the browser, resample to 16 kHz); ElevenLabs voice = ask with `connection: "websocket"` and use each `audio` event's `audio_event.audio_base_64`.

### Option A: `face: "phone"`, sound and word timing for the phone's own animation
- Today's voice (OpenAI): no timing exists; the phone has the audio track itself. No server change needed.
- ElevenLabs voice: over WebRTC ElevenLabs sends no `audio` events (no sound chunks, no timing). Send `connection: "websocket"` and the answer is `{ contender, provider: "elevenlabs_agents", signedUrl, transport: "websocket", connectHint: "elevenlabs", voice: "elevenlabs", model? }` (no `conversationToken`). The app opens `signedUrl` and reads every `{ type: "audio", audio_event: { audio_base_64, event_id, alignment: { chars, char_start_times_ms, char_durations_ms } } }` (answer `ping` with `pong`). `alignment` gives each letter's start and length in ms, from which the phone can pick mouth shapes ahead of the sound.

Unconfirmed: the `signed_url` answer field name of `get-signed-url` (step `signed_url` if wrong) and the newest Anam avatar model name.
