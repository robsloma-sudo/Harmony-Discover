-- Fail closed when either quota limit is NULL (SQL three-valued logic).
create or replace function public.discover_bottle_save_allow(
  p_subject uuid,
  p_user_max integer default 20,
  p_global_max integer default 500
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_user integer;
  v_all bigint;
begin
  if p_subject is null
     or p_user_max is null
     or p_global_max is null
     or p_user_max < 1
     or p_global_max < 1 then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('discover-bottle-save-global:' || v_day::text, 0)
  );

  select coalesce(sum(saves), 0) into v_all
  from public.discover_bottle_save_usage
  where day = v_day;

  if v_all >= p_global_max then
    return false;
  end if;

  insert into public.discover_bottle_save_usage (consumer_id, day, saves)
  values (p_subject, v_day, 1)
  on conflict (consumer_id, day)
  do update set saves = public.discover_bottle_save_usage.saves + 1
  returning saves into v_user;

  if v_user > p_user_max then
    update public.discover_bottle_save_usage
    set saves = saves - 1
    where consumer_id = p_subject and day = v_day;
    return false;
  end if;

  return true;
end
$function$;

revoke all on function public.discover_bottle_save_allow(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.discover_bottle_save_allow(uuid, integer, integer) to service_role;
