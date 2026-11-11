-- DEVELOPMENT ONLY. Apply only after 0001 in the separate Discover DEV project.
create table if not exists public.observation_jobs (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.menu_observations(id) on delete cascade,
  job_type text not null check (job_type in ('validate_assets','extract_menu')),
  status text not null default 'queued' check (status in ('queued','processing','complete','retry','failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(observation_id, job_type)
);

create table if not exists public.observation_processing_events (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.menu_observations(id) on delete cascade,
  asset_id uuid references public.observation_assets(id) on delete set null,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.observation_extractions (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.menu_observations(id) on delete cascade,
  asset_id uuid not null references public.observation_assets(id) on delete cascade,
  extraction_status text not null check (extraction_status in ('pending','ocr_unconfigured','extracted','failed')),
  sha256 text,
  normalized_object_path text,
  ocr_provider text,
  ocr_payload jsonb,
  created_at timestamptz not null default now(),
  unique(asset_id)
);

create index if not exists observation_jobs_claim_idx
  on public.observation_jobs(status, available_at, created_at);

alter table public.observation_jobs enable row level security;
alter table public.observation_processing_events enable row level security;
alter table public.observation_extractions enable row level security;

-- Jobs and processing artifacts are server-only. No client policies are granted.
create or replace function public.claim_observation_job(p_worker text)
returns setof public.observation_jobs
language sql
security definer
set search_path = public
as $$
  with candidate as (
    select id
    from public.observation_jobs
    where (status in ('queued','retry') and available_at <= now())
       or (status = 'processing' and locked_at < now() - interval '10 minutes')
    order by available_at, created_at
    for update skip locked
    limit 1
  )
  update public.observation_jobs j
  set status = 'processing',
      attempts = attempts + 1,
      locked_at = now(),
      locked_by = p_worker,
      updated_at = now()
  from candidate
  where j.id = candidate.id
  returning j.*;
$$;

revoke all on function public.claim_observation_job(text) from public, anon, authenticated;
grant execute on function public.claim_observation_job(text) to service_role;