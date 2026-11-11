# Real menu scan integration — Discover DEV

## Scope and boundary

This implementation connects the Expo client to the isolated Discover DEV project `lqqmwqrffelgnbngrkep`. It uses the public publishable key in the client and verified Supabase Auth user sessions. It never embeds a service-role key or Anthropic key. It must not be pointed at Harmony production `lqjtwabzmgjcufftuqvu`.

## Client flow

1. Camera/gallery photos remain local in `ScanContext`.
2. The user confirms the operational menu-processing notice on Preview.
3. If no session exists, the app routes to email-code sign-in.
4. After verification, the client creates an observation with `processingNoticeVersion` and `source`.
5. Each page is normalized to JPEG with `expo-image-manipulator` (including iPhone HEIC/HEIF input) and uploaded as multipart `file`.
6. Client completes the observation, calls `/read`, then fetches the observation result.
7. Preview renders actual returned items, with evidence state and verification status; mock sample items are removed from this route.

## Environment

Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from Discover DEV at build time. The URL is intentionally the Discover DEV project. Configure Supabase Auth email templates to deliver a numeric OTP using `{{ .Token }}` because the client calls `verifyOtp` with `type: 'email'`.

## Operational prerequisites

- `discover-api` v3 active in Discover DEV.
- `discover-menu-read` v3 active in Discover DEV.
- Supabase Auth email provider configured and allowed to create users.
- `ANTHROPIC_API_KEY` configured as a server-side secret on Discover DEV.
- No service-role or Anthropic credentials in the Expo client, `.env.example`, or Netlify client build variables.

## Known validation gap

The source workspace was modified, but dependency installation could not complete in this execution environment, so TypeScript compilation and an iPhone end-to-end test have not been completed. Do not treat this as a production-ready or live-deployed client. Run `npm install`, `npm run typecheck`, then test email OTP, multi-page JPEG/HEIC uploads, a real menu read, and item review in Discover DEV before deploying to Netlify.

## Iteration 22 — transcription review UI

The scan result screen now supports inline correction of each extracted item's name, section, description, and printed price, and separates correction from the Explore/Journey action. These edits are held in screen state only; they are not yet written back to `observation_items`. Do not represent them as saved or durable. The next backend step is an authenticated, owner-scoped correction endpoint with strict field validation and an audit trail before enabling a persistent Save action.

### Verified API contract (Discover DEV)

A read-only inspection of the deployed `discover-api` v3 and DEV schema confirmed:
- `POST /v1/observations` accepts `processingNoticeVersion` and `source` (`camera` or `gallery`).
- `POST /v1/observations/{id}/assets` expects multipart field `file`.
- `POST /v1/observations/{id}/complete`, `POST /v1/observations/{id}/read`, and `GET /v1/observations/{id}` are present.
- `GET` returns `id`, `status`, `pages`, `venue_name_read`, `read_at`, `quality`, and `items`, matching the frontend result type.
- The menu reader accepts JPEG, PNG, and WebP; the client normalizes picked images to JPEG before upload.

### Still unverified

- No real photo has been processed end-to-end through Anthropic.
- Presence/validity of `ANTHROPIC_API_KEY` has not been confirmed (the secret value must never be exposed to the client).
- The image URL source format used in the Anthropic request has not been live-tested.
- Iteration 22 has not passed `npm run typecheck`, an Expo build, or an iPhone/browser run because dependency installation was unavailable in the prior environment.
- Corrections are temporary screen state and are lost when leaving the screen; persistent corrections are not implemented yet.
