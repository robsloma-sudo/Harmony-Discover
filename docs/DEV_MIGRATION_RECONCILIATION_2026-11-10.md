# Harmony Discover DEV migration and security reconciliation

**Audit date:** 10 November 2026  
**Project:** `harmony-discover-dev` — `lqqmwqrffelgnbngrkep`  
**Mode:** Historical source-gap audit plus verified DEV-only migrations. Original Harmony production remains read-only.

## Executive finding

The original Discover DEV migration history still has source gaps: applied migrations 0004–0009, 0011_pg_net_out_of_public, and 0012_menu_reading are not represented by their original SQL in the current source branch. Do not fabricate or replay replacements for those historical migrations. This does not prevent applying new forward-only migrations to the existing DEV database, but a fresh environment bootstrap remains incomplete until an authoritative source recovery or catalog-derived baseline snapshot is prepared.

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

Five additional migrations have now been applied to Discover DEV only:

| Version | Applied migration name | Purpose |
|---|---|---|
| 20261110211524 | discover_harmony_sync_staging | Private `harmony_sync` schema with staged candidates, sync ledger, review events, and canonical mapping receipts |
| 20261110211548 | observation_correction_fk_indexes | Adds indexes on `observation_item_corrections.consumer_id` and `.observation_id` |
| 20261110211821 | discover_sync_permission_audit | Requires an enumerated permission basis and auditable permission reference on every staged candidate |
| 20261110215901 | marty_bartender | Adds voice consent, private user-entered memories, Comedy Lab evaluations, and service-only rate limiting |
| 20261110215936 | marty_private_table_grants | Revokes inherited PUBLIC/anon grants; keeps rate-limit table backend-only |

The staging schema contains four tables. All four have RLS enabled; `anon` and `authenticated` have no schema USAGE or table SELECT privilege; `service_role` has schema USAGE and table SELECT privilege. Each candidate must now supply a constrained permission basis (`public_source_license`, `explicit_contribution_consent`, or `operator_attested_permission`) and a 1–500 character audit reference. No candidate records have been staged, and no production connection or sync worker exists.

The performance advisor no longer reports unindexed foreign keys on `observation_item_corrections`. It reports unused indexes (expected on a newly created, empty staging schema) and an Auth connection allocation advisory. The security advisor reports the four private staging tables as RLS-enabled/no-policy, which is intentional service-only default-deny, plus existing service-only tables and the existing leaked-password-protection warning. No client policies were added.

All seven new migration source filenames in Git are aligned to the actual versions returned by the DEV migration ledger. Marty tables and the rate-limit RPC now exist in Discover DEV. The historical source gaps remain open.

## Source branch comparison

The inspected working branch contains the original `0001_discover_observations.sql`, `0002_observation_processing.sql`, `0003_learning_engine.sql`, and the correction migration source. It also contains forward-only migrations aligned to all seven newly applied DEV ledger versions, including Marty and its privilege hardening.

It does not contain the original source SQL for applied migrations 0004–0009, nor the source SQL for `0011_pg_net_out_of_public` and `0012_menu_reading`. The correction migration's source filename also differs from the live ledger name `observation_item_corrections`; its timestamp is 20261110071228. The branch's `0010_observation_item_corrections.sql` is a source filename, not proof that it is live ledger version 0010.

The live database confirms that `observation_item_corrections` exists. The timestamped Marty proposal migration is `20261110210500_marty_bartender.sql`; it is source only. Live DEV now contains the four Marty tables and `consume_marty_voice_rate_limit(uuid,timestamptz,integer)`. The RPC is SECURITY INVOKER and executable only by service_role. A follow-up ACL query confirmed anon has no SELECT privilege on any Marty table; authenticated users have no privilege on the backend-only rate-limit table; service_role retains required access.

**Required action:** recover the original SQL for all missing applied migrations from the authoritative source/backup. If exact originals cannot be recovered, produce a separately labeled schema-reconciliation snapshot from live catalog definitions, not fabricated historical migrations. New forward migrations must continue to be appended after the latest live ledger version.

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
2. Verify Discover DEV Edge Function secrets and allowed-origin configuration without exposing secret values.
3. Deploy the Realtime session endpoint to Discover DEV only; it is not yet in the live function inventory.
4. Test voice consent denial, active consent, memory withdrawal/deletion, rate limiting, credential expiry, browser CORS and actual WebRTC audio.
5. Confirm the voice endpoint's deployed source matches the reviewed Git commit.
6. Test with an authorized DEV test account and remove test artifacts afterward.
7. Keep Harmony production read-only and undeployed.

## Source references

- Live ledger queried from Supabase DEV migration metadata.
- Live schema, policies, grants, extension inventory and function inventory inspected read-only through Supabase.
- Source files: `supabase/migrations/0001_discover_observations.sql`, `0002_observation_processing.sql`, `0003_learning_engine.sql`, and `0010_observation_item_corrections.sql`.
- The migration `20261110210500_marty_bartender.sql` remains proposal source only and is not applied.


## Marty migration verification update — 10 November 2026

The Marty schema migration was applied to Discover DEV as ledger version `20261110215901`, followed by privilege hardening `20261110215936`. The live table inventory confirms all four tables and their columns. All four tables have RLS enabled. After the ACL hardening migration, anon SELECT is false on all four; authenticated SELECT is false on the service-only rate-limit table; service_role SELECT is true. The RPC is SECURITY INVOKER, and execute privilege is service_role-only. No Marty Edge Function is deployed yet.

The security advisor reports 18 RLS-enabled/no-policy informational findings, including the service-only rate-limit table and existing internal Discover tables, plus the pre-existing leaked-password-protection warning. These are not addressed by adding broad client policies. The three user-facing Marty tables have explicit owner-scoped policies; the rate-limit table is service-only.


## Final live inventory verification — 10 November 2026

- `public`: 21 base tables; all 21 have RLS enabled.
- `harmony_sync`: 4 base tables; all 4 have RLS enabled.
- Marty tables are included in the public count: `bartender_voice_consents`, `bartender_memories`, `bartender_comedy_evaluations`, and `marty_voice_rate_limits`.
- `discover-voice-session` is deployed in Discover DEV as ACTIVE version 2. Deployed bundle files were fetched and verified: `index.ts` and `_shared/martySullivanBoston.ts`.
- The latest CI run for commit `b113f2987b48086102c5ae12a6dada207c96c6b2` completed successfully: TypeScript, Deno checks, all unit tests, and Expo web export.
- The historical migration source gaps remain unresolved. A fresh project bootstrap cannot yet be reproduced from this repository alone. No fabricated historical migrations have been added.


## Consent-gated staging migration — 10 November 2026

Applied `20261110221751_discover_consent_gated_menu_staging` to Discover DEV and committed its exact SQL source. It adds a service-role-only SECURITY INVOKER routine that stages only complete, venue-confirmed, non-disputed observations with explicit per-observation contribution consent and a current non-withdrawn aggregate-research consent record. Payloads exclude consumer identifiers, private data, storage paths and signed URLs. Candidates remain pending and the ledger blocked until human review. Runtime execution returned zero; the live Discover DEV project has no menu observations and no staged candidates, so no user data was transferred.
