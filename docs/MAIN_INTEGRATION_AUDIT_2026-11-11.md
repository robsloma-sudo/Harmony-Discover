# Main integration audit — 11 November 2026

## Scope and safety
- Repository: `robsloma-sudo/Harmony-Discover`
- Target: `main`
- Integration branch: `harmony-discover-main-integration-2026-11-11`
- Integration PR: #6 (draft, open, not merged)
- Original Harmony production Supabase project `lqjtwabzmgjcufftuqvu` remains read-only and untouched.
- No Netlify production publish was performed.

## Source import
The integration branch was created directly from main commit `3501cc26997171aa053e2bb984ec8adb7ab5a643` and imports the complete source snapshot from `marty-boston-security-hardening-2026-11-10` at `188c28ef9ca022b3f6e5d8e8e13e83a7a0c0da01`.

The imported tree contains 157 files, including:
- Expo Router application under `app/`
- service/auth/voice modules under `src/`
- Discover API implementation under `apps/`
- Supabase Edge Functions and migrations
- tests, CI workflow, build scripts, deployment runbook and architecture docs

PR #6 reports 156 changed files, 23,749 additions, zero deletions after integration corrections. The branch is one commit ahead of main in ancestry after the source snapshot import (additional commits on the branch hold workflow and migration-name corrections). Main itself has not been changed.

## CI trigger correction
The imported GitHub Actions workflow originally ran pull-request validation only when the target branch was `discover-source-import-2026-11-10`. This meant PR #6 targeting `main` received no validation run.

The workflow was corrected on the integration branch to:
- run on pushes to the integration branch;
- run on pull requests targeting either `discover-source-import-2026-11-10` or `main`;
- preserve the existing validation steps: npm ci, TypeScript, Edge Function bundle build, Deno checks, unit tests, Expo web export, and artifact packaging.

Workflow correction commit: `e53687386808d99a120673bbd2803db323f647ae`.

## Migration filename reconciliation
The DEV migration ledger confirms the least-privilege migration is applied as version `20261111042025`, name `discover_venue_least_privilege_grants`.

The imported source initially named this file `20261111042100_discover_venue_least_privilege_grants.sql`. This was corrected on the integration branch to the exact ledger-aligned filename:
`supabase/migrations/20261111042025_discover_venue_least_privilege_grants.sql`.

The old filename was removed. No migration was re-applied. The DEV ledger remains authoritative.

## CI status at time of writing
- The main-integration validation workflow was successfully triggered after correcting the workflow's PR target filter.
- A second run for the updated integration head was queued.
- Do not mark CI green until the latest head's full run completes, including Expo web export and artifact packaging.
- Earlier source branch CI green runs do not substitute for validation of the integration branch head.

## Known migration reproducibility gap
The repository still does not contain authoritative SQL sources for historical migrations already present in the DEV ledger:
- `0004_learning_consent_integrity`
- `0005_observation_notice_and_retention`
- `0006_advisor_fixes`
- `0007_subject_export_and_deletion`
- `0008_learning_event_retention`
- `0009_rate_limit_and_cron_secret`
- `0011_pg_net_out_of_public`
- `0012_menu_reading`

Do not invent historical migrations or rename unrelated SQL to fill these gaps. A fresh Supabase environment cannot yet be bootstrapped reproducibly from the checked-in migration directory alone. Required follow-up:
1. recover exact original migration SQL from a trusted source/backup; or
2. create a separately labeled catalog-derived baseline snapshot from DEV and document its provenance and limitations.

The migration ledger includes these historical versions, but ledger presence is not equivalent to source-file recovery.

## Release posture
- PR #6 remains draft and unmerged.
- PR #1 remains open and draft; it was not merged or closed.
- Supabase DEV functions already deployed in the isolated DEV project are not redeployed by this GitHub import.
- No production database writes, migrations, function deployments, Netlify publishing, or production credential retrieval occurred.
- The Discover frontend still requires a verified deploy preview and successful end-to-end scan before it can be considered operational.

## Next acceptance gates
1. Latest PR #6 CI run fully green.
2. Review branch/PR changed files and resolve migration source gap plan.
3. Verify the actual Netlify deploy preview corresponds to the integration branch head and contains the compiled DEV Supabase configuration.
4. Exercise anonymous sign-in, authenticated API health/observation routes, synthetic image upload, menu-reader extraction, and failure handling.
5. Complete browser voice consent/session/audio testing separately.
6. Keep original Harmony production read-only.
