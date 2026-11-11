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
