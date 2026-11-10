# Boston Bartender — Voice Integration Contract

Status: **design contract only; no live voice endpoint or provider connection is implemented.**

## Security boundary

The mobile/web client must never contain a Supabase service-role key, provider secret key, or long-lived provider credential. The client may request a voice session only after the signed-in user explicitly activates voice and grants microphone permission. The server must authenticate the user, check applicable voice consent, enforce rate limits, and mint a short-lived provider credential. The server returns only the ephemeral session grant required by the client.

## Proposed session flow

1. User taps the bartender's push-to-talk control.
2. App requests microphone permission through the platform API. Denial returns to the idle state and explains how to enable permission.
3. App calls a future authenticated `discover-voice-session` endpoint with `{ consentVersion, mode: 'push_to_talk' }`.
4. Server validates the bearer token, consent, rate limit, Discover DEV environment guard, and provider configuration.
5. Server returns `{ sessionId, provider, ephemeralToken, expiresAt, transport, model, voice }`.
6. Client validates the grant with `validateVoiceSessionGrant` before opening the media transport.
7. Only after the transport is connected and microphone capture is confirmed may UI state become `listening`.
8. Playback, interruption, stop, expiry, and errors must update the voice state machine and release microphone/audio resources.

## Endpoint contract (not yet deployed)

- Method: `POST`
- Proposed path: `/functions/v1/discover-voice-session`
- Authentication: signed-in user's Supabase access token
- Request body: `{ "consentVersion": "<current-policy-version>", "mode": "push_to_talk" }`
- Success: short-lived `VoiceSessionGrant` object as defined in `src/voice/sessionContract.ts`
- Errors: `401` unauthenticated, `403` consent/authorization denied, `429` rate limited, `503` provider unavailable.

## Required server checks

- `DISCOVER_ENV=development` and project ref allow-list must match Discover DEV (`lqqmwqrffelgnbngrkep`).
- Explicitly reject Harmony production project ref (`lqjtwabzmgjcufftuqvu`).
- Confirm current user authentication and voice-specific consent.
- Rate-limit session creation per user and IP/device as appropriate.
- Keep provider secrets in server-side secrets only.
- Do not log ephemeral tokens, audio payloads, or raw transcripts by default.
- Enforce short expiry and prevent replay where provider capabilities permit.
- Provide stop/revoke behavior and ensure media resources close on app backgrounding.

## Product behavior

- Default mode is push-to-talk; no background listening.
- The camera remains visible while the bartender speaks/listens.
- No listening indicator before microphone permission and confirmed transport readiness.
- User can interrupt speech immediately; interruption stops playback and capture.
- Voice can be disabled independently of camera/menu scanning.
- Explain voice data handling before first use; memory/personalization consent remains separate.

## Provider decision still required

The current source tree does not identify an approved production voice provider or actor-licensed voice. Do not hard-code a provider, voice identity, or actor imitation. The existing Harmony Voice Audition utility is a separate project and must not be treated as an approved Discover backend without an explicit integration decision.

## Acceptance tests before release

- Permission denied never starts capture.
- Missing/expired/overlong session grant never opens transport.
- Provider secrets never appear in client bundle or logs.
- Listening appears only after confirmed microphone and transport readiness.
- Stop and interrupt immediately release capture/playback.
- App backgrounding closes active audio resources.
- Consent revocation prevents new sessions.
- All backend tests run against Discover DEV only.

## Client request adapter (Iteration 10)

`src/voice/voiceSessionClient.ts` now contains a provider-neutral HTTP adapter for the proposed Edge Function. It sends only the signed-in user's access token and the current consent version, requests `push_to_talk`, maps expected HTTP failures to user-safe messages, and validates the returned ephemeral grant. It does not open a microphone or media transport.

The adapter is hard-pinned to `https://lqqmwqrffelgnbngrkep.supabase.co`; it rejects any other project URL, including the Harmony production project. The Edge Function does not exist yet, so successful live requests are not expected until a separately reviewed backend implementation is authorized and deployed.

A Vitest suite covers missing authentication, valid grant handling, and rejection of non-Discover project URLs. Run with `npm run test:voice` after installing the pinned project dependencies.

## Session coordinator (Iteration 11)

`src/voice/voiceSessionCoordinator.ts` now coordinates the client-side sequence through injected platform adapters. It requires a separately confirmed consent flag before requesting OS microphone permission; it requests a short-lived grant only after permission is granted; and it enters `listening` only after the audio transport adapter's `connect()` resolves. Stop and interrupt close the adapter and return the state machine to a non-listening state. This is an orchestration layer only: no Expo microphone/audio transport adapter is implemented, and the server endpoint remains undeployed.

A new Vitest suite covers consent gating, permission denial, successful transport readiness, and resource closure. It uses a mocked fetch response and injected adapter; it does not contact Supabase or a voice provider.
