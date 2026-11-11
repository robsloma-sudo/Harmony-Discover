-- Discover DEV only. Serialize the project-wide daily frame cap so concurrent scans cannot exceed it.
-- The per-user upsert remains atomic; this transaction-scoped lock protects the global SUM + increment.
create or replace function public.discover_bottle_scan_allow(p_subject uuid, p_user_max integer, p_global_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_user integer;
  v_all bigint;
begin
  if p_subject is null or p_user_max < 1 or p_global_max < 1 then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('discover-bottle-global:' || v_day::text, 0)
  );
  select coalesce(sum(frames), 0) into v_all
  from public.bottle_scan_usage where day = v_day;
  if v_all >= p_global_max then return false; end if;
  insert into public.bottle_scan_usage (consumer_id, day, frames)
  values (p_subject, v_day, 1)
  on conflict (consumer_id, day)
  do update set frames = public.bottle_scan_usage.frames + 1
  returning frames into v_user;
  if v_user > p_user_max then
    update public.bottle_scan_usage set frames = frames - 1
    where consumer_id = p_subject and day = v_day;
    return false;
  end if;
  return true;
end
$function$;
revoke all on function public.discover_bottle_scan_allow(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.discover_bottle_scan_allow(uuid, integer, integer) to service_role;
