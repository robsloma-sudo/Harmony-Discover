# Marty Sullivan — Boston v1.0 implementation record

Updated: 10 November 2026  
Branch: `discover-source-import-2026-11-10`  
Profile: `marty-boston-v1.0.0`  
Consent policy: `marty-boston-consent-2026-11-10`

## Preservation and identity

- The original Floot project `Harmony Voice Audition` remains the authoritative complete archive and was inspected read-only.
- The original New York prompt and original comedy files under `archive/marty-sullivan-original/` were not edited.
- The new Boston/South Boston character is a separate, versioned derivative in `src/voice/martySullivanBoston.ts`.
- The Boston direction is intentionally restrained: no phonetic spelling, no cartoon accent, no repetitive tourist shorthand, and no invented venue/biography claims.
- Voice direction does not prove accent or voice texture. The historical `ash` voice at speed 0.92 is an audition baseline only, not a final voice selection.

## Current source additions

| Path | Purpose |
|---|---|
| `src/voice/martySullivanBoston.ts` | Boston prompt, comedy craft layer, version and consent version |
| `src/voice/comedyScenarios.ts` | 30 original source scenarios plus 3 Boston-local prompts = 33 |
| `app/bartender.tsx` | Web push-to-talk audition screen, transcript, typed fallback, interrupt and stop |
| `app/bartender-settings.tsx` | Separate voice and memory opt-ins; explicit memory save and delete |
| `app/comedy-lab.tsx` | Scenario deck and six-axis human scoring |
| `supabase/functions/discover-voice-session/index.ts` | DEV-only authenticated ephemeral Realtime credential endpoint source |
| `supabase/migrations/0011_marty_bartender.sql` | Consent, private memory, Comedy Lab evaluations and rate-limit schema |
| `tests/marty-profile.test.ts` | Profile provenance and scenario count regression tests |

The preservation document describes 33 scenarios in the original source. A direct read of the preserved `helpers/comedyScenarios.tsx` showed 30 entries. The Discover deck therefore preserves all 30 and adds 3 new Boston-specific scenarios; the resulting deck has 33 unique prompts.

## Voice architecture

- Reuses the existing Discover `VoiceSessionCoordinator` and `requestVoiceSession` client adapter.
- The new Edge Function verifies the bearer token with Supabase Auth, checks the exact Discover DEV project and `DISCOVER_ENV=development`, checks current voice consent, rate-limits per user, and returns only a 10-minute Realtime client secret.
- The permanent OpenAI API key remains server-side.
- Realtime configuration uses the historically auditioned `gpt-realtime-2.1`, `ash`, speed 0.92, transcription `gpt-4o-mini-transcribe`, and manual turn commit for push-to-talk.
- The web audition screen uses WebRTC, a data channel for events, transcript display, hold-to-talk, typed fallback, interrupt and stop.
- The screen explicitly does not claim the voice sounds Boston-authentic.
- Native iOS audio is not yet implemented/validated. The current voice UI blocks native activation rather than pretending native audio works.

## Consent and memory model

- Voice and memory are separate opt-ins, default false.
- Voice activation requires a signed-in account, current voice consent version, OS microphone permission and a valid short-lived grant.
- Saved memory is never created from conversation automatically. The user enters and explicitly saves each memory.
- Only three non-sensitive categories are offered: taste preference, drink history, interaction style. No health, trauma, relationship, political, religious, financial or other sensitive profile categories.
- Memory rows are account-owned and protected by RLS. Read/insert/update require active memory consent. Owner deletion remains possible after withdrawal.
- Turning memory off deletes the account's bartender-memory rows and withdraws memory consent.
- Session transcript stays in local screen state and is not saved as memory.
- Comedy Lab evaluations are saved only after the user explicitly submits all six scores. They are private to the signed-in user.
- No autonomous grading, silent profiling, or model-weight training is implemented.

## Database migration

`0011_marty_bartender.sql` is committed as source only. It has NOT been applied to Supabase DEV. It defines:
- `bartender_voice_consents`
- `bartender_memories`
- `bartender_comedy_evaluations`
- `marty_voice_rate_limits`
- `consume_marty_voice_rate_limit(...)` (service-role-only execution)

The migration grants Data API privileges only to `authenticated` for the user-facing tables; RLS remains the row boundary. The service-role rate-limit table is not client-exposed.

## Deployment and secret requirements

The Edge Function has NOT been deployed. Before a DEV deployment, set and verify these server-side secrets/config values in Discover DEV:
- `OPENAI_API_KEY`
- `DISCOVER_ENV=development`
- `DISCOVER_PROJECT_REF=lqqmwqrffelgnbngrkep`

Supabase-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` must be present in the Edge Function runtime. Do not copy secrets into source or client config. Deploy with JWT verification enabled. Do not deploy to Harmony production.

## Validation status

Verified:
- The target GitHub branch exists and was identical to recorded preservation head `03dcf2d23c0106b0b0e82bab9ccbfd0ced61ecea` before new commits.
- The original Floot project and exact NYC system prompt were read without writes.
- The new Boston profile, scenario deck, consent UI, Comedy Lab, endpoint source and migration are committed to the Discover development branch.
- Discover DEV Supabase project is active and its existing table inventory was inspected read-only.
- Current OpenAI Realtime docs confirm GA client-secret creation at `/v1/realtime/client_secrets` and WebRTC calls at `/v1/realtime/calls`.

Not yet verified:
- No migration applied; consent/memory/Comedy Lab persistence is therefore not live yet.
- No Edge Function deployed; Realtime credential minting cannot succeed yet.
- No confirmed OpenAI key presence/validity.
- No live audio audition, Boston accent assessment, or real device test.
- Native iOS transport is pending.
- Dependency install did not complete. The Iteration 28 ZIP has no `package-lock.json`; `npm ci` fails immediately for that reason and `npm install` timed out. Typecheck, Vitest and Expo web export have not been verified.
- No Netlify deployment or publish has been performed.

## Security observations

A read-only DEV security-advisor check reported 13 existing RLS-enabled tables without policies, including the pre-existing learning tables, plus the Auth leaked-password-protection warning. These are existing project findings and were not changed. The new Marty tables are designed with explicit owner policies in migration source, but those policies have not yet been applied or advisor-verified.

## Required next validation steps

1. Restore a complete dependency lockfile from the authoritative repository source; do not invent or silently regenerate an unreviewed lockfile.
2. Run `npm ci`, `npm run typecheck`, `npm run test:voice`, `npm run test:marty`, and `npm run build:web`.
3. Fix all source/test/build failures.
4. Review migration SQL, grants, RLS and service-role-only rate limiting.
5. With explicit DEV deployment approval, apply migration 0011 and deploy `discover-voice-session` to DEV only.
6. Verify missing/invalid consent is rejected, rate limit works, no permanent key reaches the client, and the ephemeral grant expires.
7. Run the web voice audition on HTTPS and real iPhone Safari/native after the native adapter exists. Evaluate actual voice audio before selecting a final voice.
8. Only after these checks, request approval for a preview deployment. Production remains read-only and undeployed.


## Current status correction — 11 November 2026

This section supersedes the historical source-only statements above where they conflict.

- The current development branch is `marty-boston-security-hardening-2026-11-10`, not the earlier `discover-source-import-2026-11-10` branch.
- Discover DEV migration `20261110215901_marty_bartender` and `20261110215936_marty_private_table_grants` are applied.
- `discover-voice-session` is ACTIVE version 4 in Discover DEV, with gateway JWT verification disabled because the handler validates the bearer token itself.
- The deployed v4 bundle was fetched and inspected. It enforces the Discover DEV project/environment guard, bearer-token verification, current voice consent, four grants per user per minute, 60-second client-secret expiry, strict request validation, origin allow-listing and no-store credential responses. Provider errors do not return provider response bodies or secrets.
- The live server-side `DISCOVER_ALLOWED_ORIGINS` value and presence/validity of `OPENAI_API_KEY` were not independently verified. No voice credential was minted.
- The selected `ash` voice remains an audition baseline only. No Boston accent or vocal texture has been approved by listening.
- The current UI supports web-only push-to-talk. Native iOS remains blocked pending a native transport adapter and device testing.
- Voice session cleanup now runs on screen blur/unmount and browser backgrounding. A release event without a matching press no longer commits an empty audio turn. This source change is on the development branch and awaits the latest CI run; it has not been published to Netlify.
- CI at commit `59cc0ebb132d4cde6dd1bb6921897a35941cd97a` passed TypeScript validation, self-contained API Edge Function build, Deno validation for voice/menu/API Edge Functions, the observation-contribution Deno test, all unit tests and web export.
- A later change at `a672a40c207c6572629f96f46530ec352c4c8eb7` adds the screen-blur/background cleanup and press-state guard. Latest validation is running for the documentation-updated PR head.
- Original Harmony production remains read-only and untouched. No Netlify publish has been performed.

### Next Marty acceptance gates

1. Confirm the latest CI result for the blur/background cleanup.
2. Verify the exact DEV browser-origin allow-list and required secret presence without displaying values. No secret-listing tool is available in this connection.
3. Complete an authenticated HTTPS browser audition using an authorized signed-in Discover account.
4. Verify voice-consent denial and withdrawal, rate limiting, short-lived credential issuance, audio start/stop/interruption, and background cleanup against DEV.
5. Evaluate real audio for character and intelligibility; do not infer a Boston accent from prompt text or the `ash` voice label.
6. Keep native iOS disabled until a native transport adapter is implemented and device-tested.
7. Request separate approval before any Netlify preview publication or production integration.


## Realtime protocol correction — 11 November 2026

A source review against the current official OpenAI API documentation caught an important distinction: this implementation calls `/v1/realtime/client_secrets` and `/v1/realtime/calls` with `session.type = realtime`. It is using the Realtime API, not the separate GPT-Live API.

The Realtime API emits `session.created` when the session is initialized. The prior draft incorrectly waited for `session.started` and attempted to send `session.close` / wait for `session.closed`, which belong to the separate Live API lifecycle. Those assumptions have been removed.

Current source commit `69356a5b1b301cafcfe15a522cfe320102835dc9`:
- waits for Realtime `session.created` before reporting Marty ready;
- fails the connection if the session never initializes or emits a Realtime error;
- immediately disables/stops local microphone tracks on cleanup;
- closes the WebRTC data channel and peer connection directly, without sending unsupported Live API close events;
- preserves blur/unmount and browser-background cleanup.

This correction is based on the official Realtime session lifecycle documentation and the distinct Live API event reference. CI for this latest commit is pending. No live authenticated voice audition has been performed yet.
