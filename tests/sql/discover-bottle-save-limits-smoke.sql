-- Isolated PostgreSQL smoke test for the daily bottle-save spend guard.
-- Runs after discover-phase5-migration-smoke.sql in the same disposable database.
\i supabase/migrations/20261112190000_discover_bottle_save_daily_limits.sql

do $quota$
declare
  user_one uuid := '51000000-0000-0000-0000-000000000001';
  user_two uuid := '51000000-0000-0000-0000-000000000002';
  i integer;
  row_count integer;
  user_one_count integer;
  user_two_count integer;
begin
  if public.discover_bottle_save_allow(null, 20, 21) then
    raise exception 'null subject must be rejected';
  end if;
  if public.discover_bottle_save_allow(user_one, 0, 21) then
    raise exception 'invalid user limit must be rejected';
  end if;

  for i in 1..20 loop
    if not public.discover_bottle_save_allow(user_one, 20, 21) then
      raise exception 'user one was blocked before reaching the per-user limit at save %', i;
    end if;
  end loop;

  if public.discover_bottle_save_allow(user_one, 20, 21) then
    raise exception 'user one must be blocked after 20 saves';
  end if;

  if not public.discover_bottle_save_allow(user_two, 20, 21) then
    raise exception 'user two should be allowed while the project has one global slot left';
  end if;

  if public.discover_bottle_save_allow(user_two, 20, 21) then
    raise exception 'project-wide limit must block the 22nd save';
  end if;

  select count(*), coalesce(sum(saves) filter (where consumer_id=user_one),0),
         coalesce(sum(saves) filter (where consumer_id=user_two),0)
  into row_count,user_one_count,user_two_count
  from public.discover_bottle_save_usage
  where day=(now() at time zone 'utc')::date;

  if row_count <> 2 or user_one_count <> 20 or user_two_count <> 1 then
    raise exception 'rejected saves must not increment counters (rows %, user1 %, user2 %)',
      row_count,user_one_count,user_two_count;
  end if;

  if not (select relrowsecurity from pg_class where oid='public.discover_bottle_save_usage'::regclass) then
    raise exception 'save usage table must have RLS enabled';
  end if;
  if has_table_privilege('anon','public.discover_bottle_save_usage','SELECT')
     or has_table_privilege('authenticated','public.discover_bottle_save_usage','SELECT') then
    raise exception 'client roles must not read save usage counters';
  end if;
  if has_function_privilege('anon','public.discover_bottle_save_allow(uuid,integer,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.discover_bottle_save_allow(uuid,integer,integer)','EXECUTE') then
    raise exception 'client roles must not execute the daily save quota RPC';
  end if;
  if not has_function_privilege('service_role','public.discover_bottle_save_allow(uuid,integer,integer)','EXECUTE') then
    raise exception 'service_role must execute the daily save quota RPC';
  end if;
end $quota$;
