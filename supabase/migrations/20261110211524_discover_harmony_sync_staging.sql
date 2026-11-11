-- Private Discover DEV integration staging only. Never apply to Harmony production.
create schema if not exists harmony_sync;
revoke all on schema harmony_sync from public, anon, authenticated;
grant usage on schema harmony_sync to service_role;

create table if not exists harmony_sync.staged_candidates (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null default '0.1.0',
  source_system text not null default 'harmony_discover' check (source_system = 'harmony_discover'),
  source_project_ref text not null check (source_project_ref = 'lqqmwqrffelgnbngrkep'),
  source_table text not null check (source_table in (
    'menu_observations','observation_items','observation_extractions','observation_item_corrections'
  )),
  source_record_id uuid not null,
  source_version integer not null default 1 check (source_version > 0),
  entity_type text not null check (entity_type in (
    'menu_observation','menu_item_observation','cocktail_spec_observation','venue_observation'
  )),
  canonical_key text,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  evidence_state text not null check (evidence_state in (
    'menu_observed','text_verified','reviewed','source_verified'
  )),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  permission_basis text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null unique,
  review_status text not null default 'pending' check (review_status in (
    'pending','approved','rejected','conflict','withdrawn'
  )),
  review_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_table, source_record_id, source_version, entity_type)
);

create table if not exists harmony_sync.sync_ledger (
  id uuid primary key default gen_random_uuid(),
  staged_candidate_id uuid not null unique references harmony_sync.staged_candidates(id) on delete restrict,
  status text not null default 'queued' check (status in (
    'queued','processing','retry','completed','blocked','failed'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  last_error_code text,
  canonical_entity_type text,
  canonical_entity_id uuid,
  canonical_receipt jsonb not null default '{}'::jsonb check (jsonb_typeof(canonical_receipt) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists harmony_sync.review_events (
  id uuid primary key default gen_random_uuid(),
  staged_candidate_id uuid not null references harmony_sync.staged_candidates(id) on delete restrict,
  event_type text not null check (event_type in (
    'staged','approved','rejected','conflict_opened','conflict_resolved','withdrawn','promoted'
  )),
  prior_status text,
  new_status text not null,
  actor_label text not null,
  reason text,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  contract_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists harmony_sync.canonical_mappings (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  source_system text not null default 'harmony_discover',
  source_record_id uuid not null,
  source_version integer not null check (source_version > 0),
  canonical_table text not null check (canonical_table in (
    'menus','menu_sections','menu_items','observations','field_provenance'
  )),
  canonical_entity_id uuid not null,
  mapping_version text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (source_system, entity_type, source_record_id, source_version),
  unique (canonical_table, canonical_entity_id, source_system, source_record_id, source_version)
);

create index if not exists staged_candidates_review_queue_idx
  on harmony_sync.staged_candidates(review_status, created_at);
create index if not exists staged_candidates_source_idx
  on harmony_sync.staged_candidates(source_table, source_record_id, source_version);
create index if not exists sync_ledger_retry_idx
  on harmony_sync.sync_ledger(status, next_attempt_at)
  where status in ('queued','retry');
create index if not exists review_events_candidate_time_idx
  on harmony_sync.review_events(staged_candidate_id, created_at desc);

alter table harmony_sync.staged_candidates enable row level security;
alter table harmony_sync.sync_ledger enable row level security;
alter table harmony_sync.review_events enable row level security;
alter table harmony_sync.canonical_mappings enable row level security;

revoke all on all tables in schema harmony_sync from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema harmony_sync to service_role;
