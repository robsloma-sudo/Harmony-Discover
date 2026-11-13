-- Isolated PostgreSQL smoke test for the daily source-backed research budget.
-- The real Supabase project supplies auth.users; this disposable CI database creates its minimal shape.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);

insert into auth.users(id) values
  ('52000000-0000-0000-0000-000000000001'),
  ('52000000-0000-0000-0000-000000000002'),
  ('52000000-0000-0000-0000-000000000003')
on conflict (id) do nothing;

\i supabase/migrations/20261113163000_discover_official_research_budget.sql

do $research_budget$
declare
  user_one uuid := '52000000-0000-0000-0000-000000000001';
  user_two uuid := '52000000-0000-0000-0000-000000000002';
  user_three uuid := '52000000-0000-0000-0000-000000000003';
  user_jobs integer;
  user_search integer;
  project_jobs integer;
  project_search integer;
begin
  if not public.discover_reserve_bottle_research_budget(user_one, 1, 2, 1, 2, 2, 4) then
    raise exception 'first user research reservation should be allowed';
  end if;
  if public.discover_reserve_bottle_research_budget(user_one, 1, 1, 1, 2, 3, 4) then
    raise exception 'per-user job limit must reject a second job';
  end if;
  if not public.discover_reserve_bottle_research_budget(user_two, 1, 2, 1, 2, 2, 4) then
    raise exception 'second user should use the remaining project budget';
  end if;
  if public.discover_reserve_bottle_research_budget(user_three, 1, 1, 1, 2, 2, 4) then
    raise exception 'project-wide job and search-unit limits must reject the next job';
  end if;

  select coalesce(sum(jobs_reserved),0), coalesce(sum(search_units_reserved),0)
    into user_jobs,user_search
  from public.bottle_research_usage
  where usage_day=(now() at time zone 'utc')::date;
  select jobs_reserved,search_units_reserved into project_jobs,project_search
  from public.bottle_research_project_usage
  where usage_day=(now() at time zone 'utc')::date;

  if user_jobs <> 2 or user_search <> 4 or project_jobs <> 2 or project_search <> 4 then
    raise exception 'rejected reservations must not increment budget counters (users %, user search %, project %, project search %)',
      user_jobs,user_search,project_jobs,project_search;
  end if;

  if not (select relrowsecurity from pg_class where oid='public.bottle_research_usage'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.bottle_research_project_usage'::regclass) then
    raise exception 'research budget tables must have RLS enabled';
  end if;
  if has_table_privilege('anon','public.bottle_research_usage','SELECT')
     or has_table_privilege('authenticated','public.bottle_research_usage','SELECT')
     or has_table_privilege('anon','public.bottle_research_project_usage','SELECT')
     or has_table_privilege('authenticated','public.bottle_research_project_usage','SELECT') then
    raise exception 'client roles must not read research budget counters';
  end if;
  if has_function_privilege('anon','public.discover_reserve_bottle_research_budget(uuid,integer,integer,integer,integer,integer,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.discover_reserve_bottle_research_budget(uuid,integer,integer,integer,integer,integer,integer)','EXECUTE') then
    raise exception 'client roles must not reserve research budget';
  end if;
  if not has_function_privilege('service_role','public.discover_reserve_bottle_research_budget(uuid,integer,integer,integer,integer,integer,integer)','EXECUTE') then
    raise exception 'service_role must reserve research budget';
  end if;
end $research_budget$;
