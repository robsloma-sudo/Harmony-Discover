# Discover DEV migration recovery and reconciliation
Captured from live project `lqqmwqrffelgnbngrkep` on 2026-11-11.

## Source of truth
The exact SQL statements were recovered from `supabase_migrations.schema_migrations.statements` in Discover DEV. They are checked into `supabase/migrations` under their actual applied version and name. This is a source recovery operation only: no historical migration was replayed.

## Reconciliation
- Live migration ledger: 34 applied migrations.
- Canonical versioned files after this recovery: 34.
- 15 migrations previously absent under their exact versioned filenames have been restored from the live ledger.
- Six pre-existing files with legacy or non-ledger filenames were moved to `recovered/legacy-sql/` so they do not masquerade as pending migrations if the CLI is used later.
- The old starter-brand SQL is retained under `recovered/legacy-sql/`: it is not an applied migration in the live ledger, although the resulting 285 brand-only rows are already present in `product_index`. Do not replay it without an explicit reconciliation decision.
- The migration `20261111154341_discover_bottle_sightings_and_product_matcher` and `20261111154707_discover_bottle_sightings_label_details` are separate canonical files. The earlier repo file combined both changes and used a different timestamp; that combined file has been replaced by the exact two applied migration sources.
- `20261111162902_discover_bottle_scan_global_cap_lock` is the newly applied DEV-only concurrency fix and has its exact versioned file.

## Safety
- Do not run `supabase db push` against production.
- Do not replay any migration already recorded in the remote ledger.
- Harmony production project `lqjtwabzmgjcufftuqvu` was not queried for migration statements or modified.
- This branch is a development/PR branch; PR #7 remains unmerged.

## Remaining migration hygiene
Before any future deployment, compare the local 34-file directory to the DEV ledger and verify a clean no-op diff. The live ledger remains the authority for applied state.
