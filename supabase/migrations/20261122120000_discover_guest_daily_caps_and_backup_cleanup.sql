-- Discover DEV · P-20261121-2146 part 3 · Guest (anonymous) AI spend limits + remove the 16 Nov backup table.
-- 1) discover_guest_usage + discover_guest_allow: extra daily limits that apply ONLY to guest (anonymous)
--    accounts, on top of the existing per-person and whole-project caps. Three checks in one step:
--      a) per guest account, b) per network (a daily-rotating keyed hash of the caller's address; the raw
--      address is never stored), c) all guests together (so free accounts can never use the whole project budget).
--    A refused request reserves nothing. Rows older than 30 days are cleared as the function runs.
--    Access follows the existing usage tables: RLS on, no policies, service role only.
-- 2) Drops public.discover_products_link_backup_20261116 (103 rows, no views/functions/jobs use it).
--    The full restore copy is in supabase/rollback/20261122120000_..._ROLLBACK.sql (md5 368e560ab735460a40f67e4aca36c8fe).
-- Nothing here changes any existing table, function, policy or grant.

create table if not exists public.discover_guest_usage (
  day date not null,
  kind text not null check (kind in ('images', 'menu_pages', 'autosave', 'bottle_save')),
  key_kind text not null check (key_kind in ('account', 'network')),
  key_id uuid not null,
  units integer not null default 0 check (units >= 0),
  primary key (day, kind, key_kind, key_id)
);
alter table public.discover_guest_usage enable row level security;
revoke all on table public.discover_guest_usage from public, anon, authenticated;
grant select, insert, update, delete on table public.discover_guest_usage to service_role;
comment on table public.discover_guest_usage is
  'P-20261121-2146: daily AI units used by guest (anonymous) Discover accounts, per account and per network (keyed daily hash, never a raw address). Service role only.';

create or replace function public.discover_guest_allow(
  p_account uuid, p_network uuid, p_kind text, p_units integer,
  p_account_max integer, p_network_max integer, p_all_guests_max integer)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_all bigint;
  v_acc integer;
  v_net integer := 0;
begin
  if p_account is null or p_kind is null or p_units is null or p_account_max is null
     or p_network_max is null or p_all_guests_max is null
     or p_units < 1 or p_units > 50 or p_account_max < 1 or p_network_max < 1 or p_all_guests_max < 1
     or p_kind not in ('images', 'menu_pages', 'autosave', 'bottle_save') then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('discover-guest:' || p_kind || ':' || v_day::text, 0)
  );

  delete from public.discover_guest_usage where day < v_day - 30;

  select coalesce(sum(units), 0) into v_all
  from public.discover_guest_usage
  where day = v_day and kind = p_kind and key_kind = 'account';
  if v_all + p_units > p_all_guests_max then return false; end if;

  insert into public.discover_guest_usage (day, kind, key_kind, key_id, units)
  values (v_day, p_kind, 'account', p_account, p_units)
  on conflict (day, kind, key_kind, key_id)
  do update set units = public.discover_guest_usage.units + p_units
  returning units into v_acc;

  if p_network is not null then
    insert into public.discover_guest_usage (day, kind, key_kind, key_id, units)
    values (v_day, p_kind, 'network', p_network, p_units)
    on conflict (day, kind, key_kind, key_id)
    do update set units = public.discover_guest_usage.units + p_units
    returning units into v_net;
  end if;

  if v_acc > p_account_max or v_net > p_network_max then
    update public.discover_guest_usage set units = units - p_units
    where day = v_day and kind = p_kind and key_kind = 'account' and key_id = p_account;
    if p_network is not null then
      update public.discover_guest_usage set units = units - p_units
      where day = v_day and kind = p_kind and key_kind = 'network' and key_id = p_network;
    end if;
    return false;
  end if;

  return true;
end
$function$;

revoke all on function public.discover_guest_allow(uuid, uuid, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.discover_guest_allow(uuid, uuid, text, integer, integer, integer, integer) to service_role;

drop table if exists public.discover_products_link_backup_20261116;
