# Harmony Discover main integration audit — 11 November 2026

## Scope and safety
- Repository: `robsloma-sudo/Harmony-Discover`
- Target: `main`
- Integration branch: `harmony-discover-main-integration-2026-11-11`
- Integration PR: #6 (draft, open, not merged)
- Original Harmony production Supabase project `lqjtwabzmgjcufftuqvu` remains read-only and untouched.
- No Netlify production publish was performed.

## Source import and CI
- Imported application tree contains 157 files; PR #6 currently reports 157 changed files.
- Includes Expo app, service/auth/voice modules, Discover API, Supabase functions and migrations, tests, build scripts, and deployment documentation.
- Workflow correction: PR validation now runs when targeting `main`; pushes to the integration branch also trigger validation.
- Latest validated head: `4e04f417a537f03fa1bf8866167e30c35d631a3d`.
- GitHub Actions run `43043761818` completed successfully. Dependency install, TypeScript, Edge API bundle build, Deno function checks, Deno permission test, full Vitest suite, Expo web export, and artifact packaging all passed.
- Pull-request-triggered validation also completed successfully.
- Artifact: `harmony-discover-web-preview`, 662,448 bytes, SHA-256 `970350a65fdb473f6618188178579dc87bec50f7f1d1bc683368b072233f72c9`, expires 18 November 2026.
- This is a CI build artifact, not a Netlify deployment or runtime test.

## Feature-branch reconciliation
The repository contains older feature branches for Atlas location flow, dock alignment, navigation, and venue Atlas foundation. Key-file comparison found:
- `app/nearby.tsx` on integration is byte-identical to the Atlas location-flow branch and Marty source branch.
- `app/bartender.tsx` on integration is byte-identical to the Marty source branch and newer than the older dock/navigation/venue branch snapshots.
- `src/services/supabase.ts` on integration contains a later DEV-only fallback bootstrap than the older feature-branch snapshots.
- The imported tree therefore contains the later versions for these checked files. This was a targeted comparison, not a complete proof that every feature-branch change is represented.
- PRs #2–#5 are closed as merged into the development lineage. PR #1 remains open/draft. PR #6 is the clean import into `main`.

## Migration filename reconciliation
The DEV migration ledger confirms the least-privilege migration as version `20261111042025`, name `discover_venue_least_privilege_grants`. The source file is present under the ledger-aligned filename:
`supabase/migrations/20261111042025_discover_venue_least_privilege_grants.sql`.
No migration was re-applied during this audit.

## Reproducibility gap: missing migration source files
The repository does not contain authoritative SQL sources for several migrations recorded as applied in Discover DEV. Previously identified missing sources include:
- `0004_learning_consent_integrity`
- `0005_observation_notice_and_retention`
- `0006_advisor_fixes`
- `0007_subject_export_and_deletion`
- `0008_learning_event_retention`
- `0009_rate_limit_and_cron_secret`
- `0011_pg_net_out_of_public`
- `0012_menu_reading`

A further gap identified in this audit: the DEV migration ledger includes `discover_venue_atlas_directory`, but its corresponding migration SQL is not in the imported source tree. The repository does contain `src/services/discoverVenueApi.ts` and Nearby UI code that depend on the venue directory. The venue least-privilege migration is not a substitute for the missing directory schema migration.

Do not invent or replay replacement historical migrations against the existing DEV database. Recover the original SQL from trusted source/history if possible. Otherwise create a catalog-derived, clearly labeled baseline/recovery script after inspecting actual DEV tables, columns, indexes, grants, RLS policies, functions, and dependencies. Validate it on a brand-new isolated scratch project before calling the setup reproducible.

## Runtime and deployment blockers
- CI success proves source validation and test/build stages passed; it does not prove live API configuration or successful menu scanning.
- Discover DEV Edge Functions have not been redeployed with the latest API/menu-reader source.
- Menu-reader source is reconstructed from deployed v3 and must be compared against the deployed artifact before replacement.
- Required server-side function secret names and exact browser origin still need verification in Discover DEV. Never paste secret values into chat.
- Supabase's built-in environment-variable reference list is not proof that custom secrets have been saved. Verify actual entries under Custom secrets.
- Netlify's `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are client build variables; they are distinct from server-side Edge Function secrets.
- Do not deploy frontend before backend functions are ready and verified.
- No end-to-end anonymous scan, authenticated observation read, menu extraction, or Boston voice audition has been completed.

## Release posture
- PR #6 remains draft and unmerged.
- PR #1 remains open and draft.
- No production database writes, migrations, Edge Function deployments, Netlify publishing, or production credential retrieval occurred.
- Original Harmony production remains read-only.
- No real observation or contribution data has been created in DEV.

## Next acceptance gates
1. Recover the missing historical migration sources or prepare and validate a catalog-derived scratch baseline.
2. Verify actual DEV custom secret presence and exact approved browser origin.
3. Review reconstructed menu-reader source against the deployed artifact.
4. Deploy the reviewed backend functions to Discover DEV only.
5. Verify health, unauthenticated 401, invalid-origin 403, anonymous session, synthetic upload, menu extraction, and failure paths.
6. Publish a Discover-only Netlify preview only after backend readiness; confirm compiled DEV configuration.
7. Complete browser Marty voice consent/session/audio testing separately.
8. Obtain separate approval before merging PR #6 or changing original Harmony production.

## Netlify publish-path audit (follow-up)
- The repository `netlify.toml` defines build command `npm ci --no-audit --no-fund && npm run build:web` and publish directory `dist`, with SPA fallback redirect to `/index.html`.
- The GitHub Actions workflow `.github/workflows/discover-validation.yml` runs typecheck, Edge Function validation, unit tests, and `npm run build:web`; it uploads `dist/` as the `harmony-discover-web-preview` artifact for **manual Netlify deployment**.
- There is no Netlify CLI/API publish command, Netlify deploy action, or other publish step in that workflow.
- Latest integration head `45cd918680aeb3a956113d25a7edb761022a2722` has successful GitHub validation run #428 (run ID `43044161414`) and run #427 (run ID `43044152979`). Artifact SHA-256: `7ee9a2daa5d0ccb3c12f58b11f04072c7ef40dcb5ef9a84d3f8526f1b3b79340`.
- GitHub commit combined status currently has no status entries; it does not expose a successful Netlify deploy for this SHA. This is not proof that no manual deploy exists, only that no matching GitHub status was returned.
- The Netlify site URL could not be inspected through the available authenticated Netlify connection in this session. Do not infer its deployed commit, branch, build context, or environment variables.
- The source's `src/services/supabase.ts` has a DEV-only fallback URL and publishable key. This code is on the unmerged integration branch. It must not be deployed into the original Harmony production site. It is intended only for the isolated Discover DEV site.
- The error `Discover API is not configured.` is thrown when the built frontend has an empty `DISCOVER_API_URL`. In the current integration source, `DISCOVER_API_URL` is derived from the Supabase URL fallback, so a live app still showing this error is likely not serving this exact source snapshot, or is serving a different bundle/configuration. This is a strong diagnostic lead, not a confirmed root cause.

### Netlify verification checklist
1. In the Netlify project for `cosmic-choux-065ee2`, open Deploys and inspect the currently published deploy's commit SHA, branch, deploy context, created/published timestamps, and deploy log.
2. Compare its SHA with `45cd918680aeb3a956113d25a7edb761022a2722` (integration branch head). If it differs, the current live site is not built from the validated integration snapshot.
3. Confirm the linked repository is `robsloma-sudo/Harmony-Discover`, the intended branch is `harmony-discover-main-integration-2026-11-11` for a test deploy, and the build command/publish directory match `netlify.toml`.
4. Confirm Deploy Preview/branch deploy environment values are Discover DEV URL and publishable key only. Never add production Harmony credentials.
5. Trigger a **non-production** Deploy Preview/branch deploy from the validated integration branch or manually deploy the CI artifact `dist/` to the isolated Discover site. Do not publish to the original Harmony site.
6. Inspect the deployed HTML/JS bundle or browser network request and verify it calls `https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-api`.
7. Re-test the original error. If it persists, capture the browser console and Network response for the first failing request; do not change backend secrets until the request proves the problem is server-side.

Netlify's deploy overview documents separate production, Deploy Preview, and branch-deploy contexts and context-specific environment variables: https://docs.netlify.com/deploy/deploy-overview/. The Deploys page retains historical deploys and identifies the source branch/commit: https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/.

## Compiled artifact inspection — 11 November 2026
- Downloaded the exact GitHub Actions artifact ID `13865474816` from run `43044701158` (commit `8808dc9422ae2ab81a789ecdf2844c4ad7bda990`), and inspected the exported web bundle.
- The artifact contains `_expo/static/js/web/entry-edc7c23e6dab52dc6d2d7c58e24f0ff9.js` (1,797,603 bytes) plus 17 route HTML files.
- The compiled bundle contains the expected Discover DEV Supabase URL `https://lqqmwqrffelgnbngrkep.supabase.co`, the DEV publishable key, and the constructed endpoint `https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-api`.
- The compiled bundle also contains the literal guard/error `Discover API is not configured.`, but the same bundle sets `DISCOVER_API_URL` from the non-empty DEV URL. Therefore this guard should not fire in this exact artifact unless runtime module initialization is altered or a different bundle is served.
- This is strong evidence that the validated CI artifact is configured correctly. It does **not** prove the Netlify site is serving this artifact. Since the live preview has displayed the guard error, the leading explanation is that Netlify is serving a different/older frontend bundle or a different site/build.
- The publishable key is intentionally public/client-side; no service-role key was found in the inspected compiled bundle by the targeted checks. Do not treat this as a complete secret-scanning certification.
- The exact artifact was downloaded and unpacked locally for inspection. It has not been deployed to Netlify from this session.

### Next operational step
- Netlify deployment access is not available through the connected tools in this session. Do not claim the artifact is live or that Netlify's deployed commit has been identified.
- Use the artifact contents as the known-good deployment candidate for the isolated Discover Netlify site only. Publish the contents of the ZIP (not the ZIP file itself) to the existing Discover site's manual deploy interface, or reconnect Netlify's Git integration to the integration branch after confirming it targets the correct site and deploy context.
- Before publishing, verify the target is `cosmic-choux-065ee2.netlify.app` and not the original Harmony site. Never deploy this DEV-only bundle to the original Harmony production domain.
- After publishing, hard-refresh the preview and inspect the served JS asset name and response. Confirm it contains the DEV project URL and calls `/functions/v1/discover-api`. Then test the scan flow.
