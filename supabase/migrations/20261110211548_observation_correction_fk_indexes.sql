-- DEVELOPMENT ONLY. Follow-up for the live Discover DEV correction table.
-- This migration is ordered after the observed DEV ledger head 20261110071228.
-- Applied to isolated Harmony Discover DEV; never apply to Harmony production.

create index if not exists observation_item_corrections_consumer_idx
  on public.observation_item_corrections(consumer_id);

create index if not exists observation_item_corrections_observation_idx
  on public.observation_item_corrections(observation_id);
