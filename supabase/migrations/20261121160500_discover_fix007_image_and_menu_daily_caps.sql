-- Discover DEV · FIX-007 · Stop paying to re-read the same view (server side).
-- 1) discover_bottle_scan_allow_units: same daily cap as discover_bottle_scan_allow, but charges N image
--    units in one step (a live frame = 1, a label batch = number of crops). bottle_scan_usage.frames now
--    counts images sent to the AI. The old 3-argument function is kept unchanged for rollback safety.
-- 2) discover_menu_read_usage + discover_menu_page_allow: a daily page cap for discover-menu-read.
-- Access follows the existing usage tables: RLS on, no policies, service role only.

create or replace function public.discover_bottle_scan_allow_units(
  p_subject uuid, p_units integer, p_user_max integer, p_global_max integer)
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
  if p_subject is null or p_units is null or p_user_max is null or p_global_max is null
     or p_units < 1 or p_units > 50 or p_user_max < 1 or p_global_max < 1 then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('discover-bottle-global:' || v_day::text, 0)
  );

  select coalesce(sum(frames), 0) into v_all
  from public.bottle_scan_usage
  where day = v_day;

  if v_all + p_units > p_global_max then return false; end if;

  insert into public.bottle_scan_usage (consumer_id, day, frames)
  values (p_subject, v_day, p_units)
  on conflict (consumer_id, day)
  do update set frames = public.bottle_scan_usage.frames + p_units
  returning frames into v_user;

  if v_user > p_user_max then
    update public.bottle_scan_usage
    set frames = frames - p_units
    where consumer_id = p_subject and day = v_day;
    return false;
  end if;

  return true;
end
$function$;

revoke all on function public.discover_bottle_scan_allow_units(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.discover_bottle_scan_allow_units(uuid, integer, integer, integer) to service_role;

comment on column public.bottle_scan_usage.frames is
  'Images sent to the AI today (FIX-007): a live frame counts 1, a label batch counts its number of crops.';

create table if not exists public.discover_menu_read_usage (
  consumer_id uuid not null,
  day date not null,
  pages integer not null default 0 check (pages >= 0),
  primary key (consumer_id, day)
);
alter table public.discover_menu_read_usage enable row level security;
revoke all on table public.discover_menu_read_usage from public, anon, authenticated;
grant select, insert, update, delete on table public.discover_menu_read_usage to service_role;
comment on table public.discover_menu_read_usage is
  'FIX-007: menu pages sent to the AI per person per UTC day (discover-menu-read daily cap).';

create or replace function public.discover_menu_page_allow(
  p_subject uuid, p_pages integer, p_user_max integer, p_global_max integer)
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
  if p_subject is null or p_pages is null or p_user_max is null or p_global_max is null
     or p_pages < 1 or p_pages > 12 or p_user_max < 1 or p_global_max < 1 then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('discover-menu-global:' || v_day::text, 0)
  );

  select coalesce(sum(pages), 0) into v_all
  from public.discover_menu_read_usage
  where day = v_day;

  if v_all + p_pages > p_global_max then return false; end if;

  insert into public.discover_menu_read_usage (consumer_id, day, pages)
  values (p_subject, v_day, p_pages)
  on conflict (consumer_id, day)
  do update set pages = public.discover_menu_read_usage.pages + p_pages
  returning pages into v_user;

  if v_user > p_user_max then
    update public.discover_menu_read_usage
    set pages = pages - p_pages
    where consumer_id = p_subject and day = v_day;
    return false;
  end if;

  return true;
end
$function$;

revoke all on function public.discover_menu_page_allow(uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.discover_menu_page_allow(uuid, integer, integer, integer) to service_role;
