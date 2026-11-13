-- Separate daily quota for explicit bottle-save/research operations.
-- This is source-only until reviewed and applied to the isolated Discover DEV project.
create table if not exists public.discover_bottle_save_usage (
  consumer_id uuid not null,
  day date not null,
  saves integer not null default 0 check (saves >= 0),
  primary key (consumer_id, day)
);

-- The global daily sum filters by day, so give that access path a leading index.
create index if not exists discover_bottle_save_usage_day_idx
  on public.discover_bottle_save_usage (day);

alter table public.discover_bottle_save_usage enable row level security;
revoke all on public.discover_bottle_save_usage from public, anon, authenticated;
grant all on public.discover_bottle_save_usage to service_role;

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
  if p_subject is null or coalesce(p_user_max, 0) < 1 or coalesce(p_global_max, 0) < 1 then
    return false;
  end if;

  -- Serialize project-wide save quota checks for this UTC day.
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
