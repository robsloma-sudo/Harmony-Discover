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

## Implementation update — source branch, not deployed

The source branch now contains `supabase/functions/discover-voice-session/index.ts`. It authenticates the signed-in user, checks the separate voice-consent record, applies the per-user DEV rate limit, and requests a 10-minute Realtime client secret. The endpoint source is not evidence of a deployed function; Discover DEV must still be checked independently.

The current source-hardening branch adds:
- exact browser-origin allow-listing through the server-side `DISCOVER_ALLOWED_ORIGINS` comma-separated environment variable;
- `Cache-Control: no-store, private` and `Pragma: no-cache` on credential responses;
- JSON content-type, strict request-shape, and 2 KiB body-size checks;
- explicit instructions that user-authored memory values are untrusted data, not system instructions.

For browser use, set `DISCOVER_ALLOWED_ORIGINS` in the Discover DEV Edge Function secrets/config to the exact HTTPS origin(s), without trailing slash (for example, the actual approved Netlify preview origin). Do not put this setting in an `EXPO_PUBLIC_*` variable. Requests without an Origin header are allowed for native clients; browser origins not on the allow-list are rejected.

The Boston migration remains unapplied. Do not deploy the function until the migration ledger and source migration history have been reconciled. The current DEV ledger contains timestamped migrations through `20261110071228`, including `0011_pg_net_out_of_public` and `0012_menu_reading`; the branch's numbered `20261110210500_marty_bartender.sql` is not a safe direct match for that ledger. Recover the complete applied migration source history before creating a correctly versioned follow-on migration.

## Lead-agent follow-up code review — 10 November 2026

A static review of the current source branch found and corrected two lifecycle defects before any deployment:

1. **Session credential startup crash:** the Edge Function initialized `memoryContext` by referencing `memories` before the database query declared that variable. This would have thrown a ReferenceError on every authenticated request reaching that line, even when memory consent was off. The initializer is now empty, and the memory query populates it only after checking current memory consent. User-authored memory values are serialized as JSON and explicitly treated as untrusted data.
2. **Microphone cleanup / retry:** if microphone permission resolved after the user stopped or interrupted, the newly acquired stream could remain open. A failed ephemeral-grant request could also leave the stream allocated. The coordinator now closes the adapter in both cases; the UI clears a failed coordinator and allows retry. A regression assertion checks late-permission cleanup.

These are source changes on the hardening branch only. No deployed function was changed. GitHub Actions still reports no workflow run or status check for the current branch, so the regression suite has not yet been executed in CI.

## Remaining voice implementation limitations

- The current actual media transport is web-only. The app explicitly blocks voice on native iOS/Android until a native audio/WebRTC adapter is implemented and device-tested.
- The selected provider voice is `ash` as an audition baseline. No Boston accent, rasp, age, or local vocal identity has been verified in real audio.
- Voice session transcripts exist only in in-memory screen state and are not persisted as memory.
- Consent withdrawal prevents subsequent server-issued sessions. Existing active Realtime sessions are not remotely terminated by the settings write; the client must stop the active session. A production-ready consent UX should make this lifecycle explicit and close an active session immediately when voice is disabled.
- The client-side typed fallback is available only after the Realtime data channel is connected; it is not a standalone non-voice chat path.


## Current DEV deployment — 10 November 2026

The prior "not deployed" statements above are historical and superseded by this section.

- Discover DEV migration `20261110215901_marty_bartender` is applied.
- Discover DEV migration `20261110215936_marty_private_table_grants` is applied.
- `discover-voice-session` is deployed and ACTIVE at version 2 in project `lqqmwqrffelgnbngrkep`, with gateway JWT verification disabled because the handler validates the bearer token itself.
- The deployed function bundle contains `index.ts` and `_shared/martySullivanBoston.ts`. The deployed source was fetched after deployment and the inventory confirms version 2.
- The app and Edge Function now import the same canonical Boston prompt module from `supabase/functions/discover-voice-session/_shared/martySullivanBoston.ts`; the old duplicate shared copy was removed.
- No browser audition has been completed. The browser-origin allow-list is controlled by the server-side `DISCOVER_ALLOWED_ORIGINS` setting. Its actual value has not been verified. Browser voice remains blocked until the exact approved Discover preview origin is configured.
- The Edge Function's required server-side values are `DISCOVER_ENV=development`, `DISCOVER_PROJECT_REF=lqqmwqrffelgnbngrkep`, `OPENAI_API_KEY`, plus Supabase URL/anon/service credentials. Secret values were not retrieved or displayed; their presence has not been independently verified.
- No Realtime credential request or audio session has been performed. A deployed ACTIVE function does not prove the secrets/origin settings are complete or that the provider call succeeds.
- Native iOS voice remains disabled in the UI pending a native audio adapter and device test.
- Original Harmony production has not been changed.

### Remaining validation
1. Verify the required DEV function secrets are present without revealing their values.
2. Configure `DISCOVER_ALLOWED_ORIGINS` to the exact Discover preview origin.
3. Test OPTIONS/CORS and authenticated consent-denied/consent-approved calls.
4. Verify the Realtime client-secret response and expiry without logging its token.
5. Run an actual web push-to-talk audition, then test stop, interrupt, memory withdrawal, and rate limiting.
6. Test native iOS separately; do not label it supported until device validation passes.


### Realtime credential replay-window hardening

The OpenAI Realtime client-secret documentation states that a client secret can be used to create multiple sessions until it expires; the established session can continue after that client-secret expiry. To reduce the replay window, the current DEV endpoint requests a 60-second client-secret lifetime and allows four mint requests per user per minute. The client validator rejects grants longer than two minutes to allow limited clock/network tolerance. This reduces exposure but does not make a bearer client secret single-use. The endpoint is ACTIVE as version 3 in Discover DEV; the deployed source was fetched and verified after deployment. No provider credential was minted and no audio session was opened during this verification.


### Current Realtime API compatibility review

The live OpenAI Realtime client-secret API reference confirms the configured `gpt-realtime-2.1` model, `ash` voice, audio-only output, manual turn detection (`turn_detection: null`), and speech speed `0.92` are supported configuration values. The input transcription model was changed from the deprecated `gpt-4o-mini-transcribe` to `gpt-live-transcribe`. The deployed Discover DEV function is ACTIVE version 4. This is a static API-schema review; a real provider credential/audio call is still pending.


### Discover preview origin identified

The previously shared Harmony Discover Netlify deployment is `https://cosmic-choux-065ee2.netlify.app`. The exact browser origin to add to the Discover DEV `DISCOVER_ALLOWED_ORIGINS` setting is:

```text
https://cosmic-choux-065ee2.netlify.app
```

This value has been documented but not yet written to Supabase Function secrets. No saved browser profile is currently recorded as signed in to Supabase, so dashboard configuration requires the user to confirm an existing signed-in profile or complete a sign-in setup session.
