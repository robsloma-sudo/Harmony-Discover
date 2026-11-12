-- Discover DEV: durable asynchronous bottle research queue.
-- Additive; does not touch the main Harmony PHG database.
create table if not exists public.bottle_research_jobs (
  id uuid primary key default gen_random_uuid(),
  sighting_id uuid not null unique references public.bottle_sightings(id) on delete cascade,
  consumer_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bottle_research_jobs_ready_idx
  on public.bottle_research_jobs (available_at, created_at)
  where status in ('queued','failed');
alter table public.bottle_research_jobs enable row level security;
revoke all on public.bottle_research_jobs from anon, authenticated;
grant all on public.bottle_research_jobs to service_role;

create or replace function public.discover_claim_bottle_research_jobs(p_worker text, p_limit integer default 10)
returns setof public.bottle_research_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  if p_worker is null or length(p_worker) < 8 then raise exception 'invalid worker id'; end if;
  return query
  with picked as (
    select j.id from public.bottle_research_jobs j
    where ((j.status in ('queued','failed') and j.available_at <= now())
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
  if p_status not in ('completed','failed') then raise exception 'invalid job status'; end if;
  update public.bottle_research_jobs
  set status=p_status,
      available_at=case when p_status='failed' and attempts < 4
        then now() + make_interval(secs => least(900, 15 * power(4, greatest(attempts-1,0))::integer))
        else available_at end,
      locked_at=null, locked_by=null,
      last_error=left(coalesce(p_error,''),500), updated_at=now()
  where id=p_job and status='processing' and locked_by=p_worker
  returning * into v;
  return found;
end $$;

revoke execute on function public.discover_claim_bottle_research_jobs(text,integer) from public, anon, authenticated;
revoke execute on function public.discover_finish_bottle_research_job(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.discover_claim_bottle_research_jobs(text,integer) to service_role;
grant execute on function public.discover_finish_bottle_research_job(uuid,text,text,text) to service_role;
