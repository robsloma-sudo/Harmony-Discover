# Harmony Discover DEV migration and security reconciliation

**Audit date:** 10 November 2026  
**Project:** `harmony-discover-dev` — `lqqmwqrffelgnbngrkep`  
**Mode:** Read-only database inspection. No SQL writes, migrations, function deployments, secrets changes, or production operations.

## Executive finding

Do not apply the Marty migration yet. The Git branch's migration directory is not a complete, ledger-aligned representation of the live Discover DEV database. The live project has 13 applied migrations; source branch history has gaps and a filename/sequence mismatch.

## Live migration ledger

The live Supabase migration ledger returned:

| Version | Applied migration name |
|---|---|
| 20261109203719 | 0001_discover_observations |
| 20261109203726 | 0002_observation_processing |
| 20261109203744 | 0003_learning_engine |
| 20261109203803 | 0004_learning_consent_integrity |
| 20261109203816 | 0005_observation_notice_and_retention |
| 20261109203943 | 0006_advisor_fixes |
| 20261109204544 | 0007_subject_export_and_deletion |
| 20261109210554 | 0008_learning_event_retention |
| 20261109211625 | 0009_rate_limit_and_cron_secret |
| 20261109211724 | 0010_schedule_retention |
| 20261109212554 | 0011_pg_net_out_of_public |
| 20261109220329 | 0012_menu_reading |
| 20261110071228 | observation_item_corrections |

## Follow-up DEV changes (read-only verification after applying isolated migrations)

Two new migrations have now been applied to Discover DEV only:

| Version | Applied migration name | Purpose |
|---|---|---|
| 20261110211524 | discover_harmony_sync_staging | Private `harmony_sync` schema with staged candidates, sync ledger, review events, and canonical mapping receipts |
| 20261110211548 | observation_correction_fk_indexes | Adds indexes on `observation_item_corrections.consumer_id` and `.observation_id` |
| 20261110211821 | discover_sync_permission_audit | Requires an enumerated permission basis and auditable permission reference on every staged candidate |

The staging schema contains four tables. All four have RLS enabled; `anon` and `authenticated` have no schema USAGE or table SELECT privilege; `service_role` has schema USAGE and table SELECT privilege. Each candidate must now supply a constrained permission basis (`public_source_license`, `explicit_contribution_consent`, or `operator_attested_permission`) and a 1–500 character audit reference. No candidate records have been staged, and no production connection or sync worker exists.

The performance advisor no longer reports unindexed foreign keys on `observation_item_corrections`. It reports unused indexes (expected on a newly created, empty staging schema) and an Auth connection allocation advisory. The security advisor reports the four private staging tables as RLS-enabled/no-policy, which is intentional service-only default-deny, plus existing service-only tables and the existing leaked-password-protection warning. No client policies were added.

The source filenames in Git have been aligned to the actual versions returned by the DEV migration ledger. The Marty migration remains unapplied.

## Source branch comparison

The inspected Git branch `discover-source-import-2026-11-10` contains:
- `0001_discover_observations.sql`
- `0002_observation_processing.sql`
- `0003_learning_engine.sql`
- `0010_observation_item_corrections.sql`
- `20261110210500_marty_bartender.sql` (Marty proposal only; NOT applied)

It does not contain the original source SQL for applied migrations 0004–0009, nor the source SQL for `0011_pg_net_out_of_public` and `0012_menu_reading`. The correction migration's source filename also differs from the live ledger name `observation_item_corrections`; its timestamp is 20261110071228. The branch's `0010_observation_item_corrections.sql` is a source filename, not proof that it is live ledger version 0010.

The live database confirms that `observation_item_corrections` exists. The timestamped Marty proposal migration is `20261110210500_marty_bartender.sql`; it is source only. The branch's Marty tables and RPC do not exist in DEV:
- `bartender_voice_consents`
- `bartender_memories`
- `bartender_comedy_evaluations`
- `marty_voice_rate_limits`
- `consume_marty_voice_rate_limit(...)`

**Required action:** recover the original SQL for all missing applied migrations from the authoritative source/backup. If exact originals cannot be recovered, produce a separately labeled schema-reconciliation snapshot from live catalog definitions, not fabricated historical migrations. The two new migrations above are already recorded and their source filenames are aligned to their exact live ledger versions. Add Marty only as a new migration after the latest live version and review it against the actual live schema before applying.

## Live DEV schema and RLS observations

Read-only catalog inspection found 17 public base tables, all with RLS enabled. Six explicit policies exist:
- `menu_observations`: authenticated owner SELECT
- `observation_assets`: authenticated owner SELECT
- `observation_items`: authenticated owner SELECT
- `personal_taste_profiles`: authenticated owner SELECT, INSERT, UPDATE

The other RLS-enabled tables currently have no explicit public policies. That is consistent with the intended service-mediated access described in the source for raw learning events, jobs, processing artifacts, consent and internal learning operations; with RLS enabled and no matching policy, direct client row access is denied. Do not add broad client policies merely to silence the advisor.

The catalog also reports broad table-level grants to `anon` and `authenticated` on multiple tables. RLS remains the row boundary, but grants should be reconciled to the intended least-privilege model as a separate, reviewed security task. In particular, verify the default privileges that produced these grants, revoke unnecessary privileges only after enumerating required API paths, and rerun advisors. This audit did not alter grants or policies.

The installed `pg_net` extension is in schema `extensions`, consistent with the ledger entry `0011_pg_net_out_of_public`.

## Current Edge Functions

The live DEV function inventory at audit time:
- `discover-api`: ACTIVE, version 6, gateway JWT verification disabled (handler must continue to validate bearer tokens itself).
- `discover-retention`: ACTIVE, version 1, gateway JWT verification disabled (verify its own cron-secret gate before treating as safe).
- `discover-menu-read`: ACTIVE, version 3, gateway JWT verification enabled.

The older `docs/DEV_BACKEND_VERIFICATION_2026-11-10.md` records `discover-api` version 3 and is stale relative to the current live inventory. Update that document after validating the deployed source.

## Marty release gates

1. Recover or formally replace the missing historical migration source; never replay reconstructed old migrations against the live DEV database.
2. Create a new, uniquely timestamped Marty migration after the current ledger head.
3. Review owner scoping, RLS, grants, service-role-only rate limiting, indexes, consent withdrawal semantics and deletion behavior.
4. Confirm the Realtime client-secret endpoint has the correct DEV-only environment checks and allowed-origin configuration.
5. Validate source, TypeScript, unit tests, web export and real browser audio.
6. Apply the migration and deploy the Edge Function to Discover DEV only after explicit user approval.
7. Recheck the live schema, security advisors, endpoint behavior, consent denial, rate limits, credential expiry and client bundle for leaked permanent secrets.
8. Keep Harmony production read-only and undeployed.

## Source references

- Live ledger queried from Supabase DEV migration metadata.
- Live schema, policies, grants, extension inventory and function inventory inspected read-only through Supabase.
- Source files: `supabase/migrations/0001_discover_observations.sql`, `0002_observation_processing.sql`, `0003_learning_engine.sql`, and `0010_observation_item_corrections.sql`.
- The migration `20261110210500_marty_bartender.sql` remains proposal source only and is not applied.
