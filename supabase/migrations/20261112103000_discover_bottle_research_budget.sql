-- Discover DEV only: daily research budgets and deferrable queue state.
alter table public.bottle_research_jobs
  drop constraint if exists bottle_research_jobs_status_check;
alter table public.bottle_research_jobs
  add constraint bottle_research_jobs_status_check
  check (status in ('queued','processing','completed','failed','deferred'));

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
  p_consumer uuid, p_jobs integer default 1, p_search_units integer default 2,
  p_user_jobs_max integer default 5, p_project_jobs_max integer default 100,
  p_user_search_max integer default 10, p_project_search_max integer default 200
) returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_user public.bottle_research_usage;
  v_project public.bottle_research_project_usage;
begin
  if p_consumer is null or p_jobs < 1 or p_search_units < 1 then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('discover-research-budget:' || v_day::text, 0));
  insert into public.bottle_research_usage(usage_day,consumer_id) values(v_day,p_consumer)
    on conflict (usage_day,consumer_id) do nothing;
  insert into public.bottle_research_project_usage(usage_day) values(v_day)
    on conflict (usage_day) do nothing;
  select * into v_user from public.bottle_research_usage where usage_day=v_day and consumer_id=p_consumer for update;
  select * into v_project from public.bottle_research_project_usage where usage_day=v_day for update;
  if v_user.jobs_reserved+p_jobs > p_user_jobs_max
     or v_project.jobs_reserved+p_jobs > p_project_jobs_max
     or v_user.search_units_reserved+p_search_units > p_user_search_max
     or v_project.search_units_reserved+p_search_units > p_project_search_max then
    return false;
  end if;
  update public.bottle_research_usage set jobs_reserved=jobs_reserved+p_jobs,
    search_units_reserved=search_units_reserved+p_search_units,updated_at=now()
    where usage_day=v_day and consumer_id=p_consumer;
  update public.bottle_research_project_usage set jobs_reserved=jobs_reserved+p_jobs,
    search_units_reserved=search_units_reserved+p_search_units,updated_at=now()
    where usage_day=v_day;
  return true;
end $$;

create or replace function public.discover_claim_bottle_research_jobs(p_worker text, p_limit integer default 10)
returns setof public.bottle_research_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  if p_worker is null or length(p_worker) < 8 then raise exception 'invalid worker id'; end if;
  return query
  with picked as (
    select j.id from public.bottle_research_jobs j
    where ((j.status in ('queued','failed','deferred') and j.available_at <= now())
       or (j.status = 'processing' and j.locked_at < now() - interval '5 minutes'))
      and j.attempts < 4
    order by j.available_at, j.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit,10),20))
  )
  update public.bottle_research_jobs j
  set status='processing', attempts=j.attempts+1, locked_at=now(),
      locked_by=p_worker, updated_at=now(), last_error=null
  from picked where j.id=picked.id
  returning j.*;
end $$;

create or replace function public.discover_finish_bottle_research_job(
  p_job uuid, p_worker text, p_status text, p_error text default null
) returns boolean language plpgsql security definer set search_path = ''
as $$
declare v public.bottle_research_jobs;
begin
  if p_status not in ('completed','failed','deferred') then raise exception 'invalid job status'; end if;
  update public.bottle_research_jobs
  set status=p_status,
      available_at=case
        when p_status='failed' and attempts < 4 then now() + make_interval(secs => least(900, 15 * power(4, greatest(attempts-1,0))::integer))
        when p_status='deferred' then date_trunc('day',now() at time zone 'utc') + interval '1 day'
        else available_at end,
      locked_at=null, locked_by=null,
      last_error=left(coalesce(p_error,''),500), updated_at=now()
  where id=p_job and status='processing' and locked_by=p_worker
  returning * into v;
  return found;
end $$;

revoke execute on function public.discover_reserve_bottle_research_budget(uuid,integer,integer,integer,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.discover_reserve_bottle_research_budget(uuid,integer,integer,integer,integer,integer,integer) to service_role;
