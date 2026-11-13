-- Discover DEV only: bounded daily budget for source-backed product research.
-- Reuses the existing discover_enrichment_jobs queue; no parallel job queue is created.
create table if not exists public.bottle_research_usage (
  usage_day date not null,
  consumer_id uuid not null references auth.users(id) on delete cascade,
  jobs_reserved integer not null default 0 check (jobs_reserved >= 0),
  search_units_reserved integer not null default 0 check (search_units_reserved >= 0),
  updated_at timestamptz not null default now(),
  primary key (usage_day, consumer_id)
);

create table if not exists public.bottle_research_project_usage (
  usage_day date primary key,
  jobs_reserved integer not null default 0 check (jobs_reserved >= 0),
  search_units_reserved integer not null default 0 check (search_units_reserved >= 0),
  updated_at timestamptz not null default now()
);

alter table public.bottle_research_usage enable row level security;
alter table public.bottle_research_project_usage enable row level security;
revoke all on public.bottle_research_usage, public.bottle_research_project_usage from public, anon, authenticated;
grant all on public.bottle_research_usage, public.bottle_research_project_usage to service_role;

create or replace function public.discover_reserve_bottle_research_budget(
  p_consumer uuid,
  p_jobs integer default 1,
  p_search_units integer default 2,
  p_user_jobs_max integer default 5,
  p_project_jobs_max integer default 100,
  p_user_search_max integer default 10,
  p_project_search_max integer default 200
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_user public.bottle_research_usage;
  v_project public.bottle_research_project_usage;
begin
  if p_consumer is null or p_jobs < 1 or p_search_units < 1
     or p_user_jobs_max < 1 or p_project_jobs_max < 1
     or p_user_search_max < 1 or p_project_search_max < 1 then
    return false;
  end if;

  -- One project/day lock makes the per-user and project-wide reservation atomic.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('discover-research-budget:' || v_day::text, 0)
  );

  insert into public.bottle_research_usage(usage_day, consumer_id)
  values (v_day, p_consumer)
  on conflict (usage_day, consumer_id) do nothing;

  insert into public.bottle_research_project_usage(usage_day)
  values (v_day)
  on conflict (usage_day) do nothing;

  select * into v_user
  from public.bottle_research_usage
  where usage_day = v_day and consumer_id = p_consumer
  for update;

  select * into v_project
  from public.bottle_research_project_usage
  where usage_day = v_day
  for update;

  if v_user.jobs_reserved + p_jobs > p_user_jobs_max
     or v_project.jobs_reserved + p_jobs > p_project_jobs_max
     or v_user.search_units_reserved + p_search_units > p_user_search_max
     or v_project.search_units_reserved + p_search_units > p_project_search_max then
    return false;
  end if;

  update public.bottle_research_usage
  set jobs_reserved = jobs_reserved + p_jobs,
      search_units_reserved = search_units_reserved + p_search_units,
      updated_at = now()
  where usage_day = v_day and consumer_id = p_consumer;

  update public.bottle_research_project_usage
  set jobs_reserved = jobs_reserved + p_jobs,
      search_units_reserved = search_units_reserved + p_search_units,
      updated_at = now()
  where usage_day = v_day;

  return true;
end;
$$;

revoke all on function public.discover_reserve_bottle_research_budget(uuid,integer,integer,integer,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.discover_reserve_bottle_research_budget(uuid,integer,integer,integer,integer,integer,integer)
  to service_role;
