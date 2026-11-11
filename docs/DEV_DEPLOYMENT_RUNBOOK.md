# Harmony Discover DEV deployment runbook

**Target project:** `lqqmwqrffelgnbngrkep` (`harmony-discover-dev`)  
**Production project:** `lqjtwabzmgjcufftuqvu` — prohibited target; do not deploy, link, or write to it.

This document describes the DEV release sequence. It is not authorization to deploy. The current PR remains draft until the source, environment and runtime checks are reviewed and an explicit release decision is made.

## 1. Netlify web app environment

Set these as Netlify build-time environment variables for the Discover site:

- `EXPO_PUBLIC_SUPABASE_URL` = `https://lqqmwqrffelgnbngrkep.supabase.co`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = the publishable key for the same DEV project

Never put a service-role key, OpenAI key, Anthropic key or any other server secret in an `EXPO_PUBLIC_*` variable.

The browser origin must be added to the server-side `DISCOVER_ALLOWED_ORIGINS` allow-list as an exact HTTPS origin (scheme + host + optional port; no path and no trailing slash). Include only the actual Netlify production/preview origins intended to call the DEV API. Do not guess this value.

## 2. Discover DEV Edge Function secrets and non-secret settings

Configure only in project `lqqmwqrffelgnbngrkep`:

| Name | Used by | Requirement |
|---|---|---|
| `DISCOVER_ENV` | API, voice | `development` |
| `DISCOVER_ALLOWED_PROJECT_REFS` | API | exactly `lqqmwqrffelgnbngrkep` |
| `DISCOVER_PROJECT_REF` | voice | exactly `lqqmwqrffelgnbngrkep` |
| `DISCOVER_ALLOWED_ORIGINS` | API, reader, voice | exact approved HTTPS browser origins |
| `SUPABASE_SERVICE_ROLE_KEY` | API, reader, voice | Supabase-provided server secret; never expose to client |
| `SUPABASE_ANON_KEY` | voice | legacy anon key used by the current voice endpoint |
| `OPENAI_API_KEY` | voice | server-side provider key |
| `ANTHROPIC_API_KEY` | menu reader | server-side provider key |
| `DISCOVER_MENU_MODEL` | menu reader | optional override; default is `claude-haiku-4-5` |

`SUPABASE_URL` is provided by Supabase at runtime. Verify that the project URL resolves to the DEV ref before enabling any function.

Do not copy secrets from the original Harmony project. Do not request or print secret values in chat. Verify presence by secret name through the Supabase project settings.

## 3. Build and validate the deployable API bundle

From the repository root:

```bash
npm ci
npm run typecheck
npm run test:all
npm run build:edge
deno check --node-modules-dir=auto supabase/functions/discover-api/index.ts
deno check --node-modules-dir=auto supabase/functions/discover-menu-read/index.ts
deno check --node-modules-dir=auto supabase/functions/discover-voice-session/index.ts
deno test --node-modules-dir=auto apps/api/tests/observation-contribution-permission.deno.ts
```

The `build:edge` command generates `supabase/functions/discover-api/_shared` from the reviewed application source. That generated directory is intentionally git-ignored. Run the build before any local CLI deploy or package upload.

## 4. Release order (DEV only)

1. Confirm the linked/target project ref is `lqqmwqrffelgnbngrkep`. Stop if it is anything else.
2. Confirm the exact origins and required secret names are configured in DEV.
3. Compare the reconstructed `discover-menu-read` source against the currently deployed v3 artifact one last time. Do not replace it until the diff is understood.
4. Deploy `discover-api` to DEV with JWT gateway verification disabled only because the handler performs Supabase Auth token verification itself. Preserve that explicit behavior.
5. Deploy `discover-menu-read` to DEV with gateway JWT verification enabled.
6. Deploy `discover-voice-session` only after reviewing its current deployed-vs-source diff; preserve the explicit bearer validation and DEV project guard.
7. Publish the Expo web build to the Discover Netlify site only after the server functions are ready. Do not change the original Harmony Netlify site.
8. Verify health route, unauthenticated 401, invalid-origin 403, and authenticated observation endpoints before any real user test.

The Supabase CLI v3 changed hosted-project behavior; use an explicit project ref and review every hosted-change confirmation. Do not rely on a default linked project. The MCP Edge Function deploy action also replaces the live function immediately, so it is a release operation, not a harmless preview.

## 5. End-to-end acceptance tests

Use a dedicated test account and synthetic menu photos, not a real customer's data.

- A user can sign in and accept the exact menu-processing notice.
- An upload with 1–12 pages succeeds; page 13 is rejected before it is stored.
- A scan with any failed page, zero saved structured items, dispute or unresolved flags cannot receive a contribution grant.
- Venue confirmation is required and is saved to the same owned observation.
- Contribution permission is separate, unchecked by default, versioned, observation-specific and can be withdrawn.
- Withdrawal marks any not-yet-promoted candidate withdrawn and blocks its sync ledger.
- No scan, grant, staged candidate or audit event is automatically promoted to original Harmony.
- Boston Marty voice can start only after its separate voice consent; memory consent remains independent.
- Voice withdrawal and memory withdrawal are verified independently.
- Native iOS audio remains explicitly unsupported until the native audio adapter is implemented and tested.

## 6. Current release state

As of 10 November 2026:

- Source branch: `marty-boston-security-hardening-2026-11-10`.
- PR #1 is open and draft.
- CI has passed on commit `6f9c11361b1a2b67e89dfe68341a9ea257bafd58`; subsequent bundle and page-limit changes require a fresh green run.
- DEV schema migrations for consent-gated staging are applied.
- DEV currently contains zero observations, contribution grants, grant events, staged candidates, review events and sync-ledger rows.
- Deployed Edge Function versions have not yet been replaced by this branch's source.
- No Netlify release or original Harmony production write/deployment has occurred.
