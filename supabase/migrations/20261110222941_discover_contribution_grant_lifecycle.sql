alter table public.observation_contribution_grants
  drop constraint if exists observation_contribution_grants_one_per_observation;

create unique index if not exists observation_contribution_grants_one_active_per_observation
  on public.observation_contribution_grants(observation_id)
  where withdrawn_at is null;

create table if not exists public.observation_contribution_grant_events (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.observation_contribution_grants(id) on delete cascade,
  observation_id uuid not null references public.menu_observations(id) on delete cascade,
  consumer_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('granted','withdrawn')),
  policy_version text not null,
  created_at timestamptz not null default now()
);
alter table public.observation_contribution_grant_events enable row level security;
revoke all on public.observation_contribution_grant_events from public, anon, authenticated;
grant select, insert on public.observation_contribution_grant_events to service_role;

create or replace function public.discover_grant_observation_contribution(
  p_subject uuid, p_observation uuid, p_policy_version text
) returns uuid
language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_grant uuid;
begin
  if p_subject is null or p_observation is null or p_policy_version is null
     or char_length(trim(p_policy_version)) < 1 or char_length(trim(p_policy_version)) > 120 then
    raise exception 'invalid_contribution_grant' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.menu_observations o
    where o.id=p_observation and o.consumer_id=p_subject and o.status='ready_for_review'
  ) then raise exception 'observation_not_eligible' using errcode = '42501'; end if;
  insert into public.observation_contribution_grants(observation_id,consumer_id,policy_version)
  values(p_observation,p_subject,trim(p_policy_version)) returning id into v_grant;
  insert into public.observation_contribution_grant_events(grant_id,observation_id,consumer_id,event_type,policy_version)
  values(v_grant,p_observation,p_subject,'granted',trim(p_policy_version));
  return v_grant;
end;
$$;
revoke all on function public.discover_grant_observation_contribution(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.discover_grant_observation_contribution(uuid,uuid,text) to service_role;

create or replace function public.discover_withdraw_observation_contribution(
  p_subject uuid, p_observation uuid
) returns boolean
language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_grant public.observation_contribution_grants%rowtype;
begin
  if p_subject is null or p_observation is null then
    raise exception 'invalid_contribution_withdrawal' using errcode = '22023';
  end if;
  select * into v_grant from public.observation_contribution_grants
  where observation_id=p_observation and consumer_id=p_subject and withdrawn_at is null for update;
  if not found then return false; end if;
  update public.observation_contribution_grants set withdrawn_at=now(),updated_at=now() where id=v_grant.id;
  insert into public.observation_contribution_grant_events(grant_id,observation_id,consumer_id,event_type,policy_version)
  values(v_grant.id,p_observation,p_subject,'withdrawn',v_grant.policy_version);
  return true;
end;
$$;
revoke all on function public.discover_withdraw_observation_contribution(uuid,uuid) from public, anon, authenticated;
grant execute on function public.discover_withdraw_observation_contribution(uuid,uuid) to service_role;