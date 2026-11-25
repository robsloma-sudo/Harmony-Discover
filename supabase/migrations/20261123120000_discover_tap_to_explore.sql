-- Discover DEV · P-20261123-0711 part 3 · Tap-to-explore from a scanned menu (server side).
-- Adds (all service-role only: RLS on, no policies, like discover_guest_usage):
--   discover_explore_menu_links   one row per scanned menu: the linked drink lines (so a 2nd open is instant)
--   discover_explore_journeys     shared Journey cache (fast path at the table; freshness is checked by the program)
--   discover_explore_journey_builds  in-flight Journey build marker, one row per (item_kind,item_ref); NO person id (not personal data)
--   discover_explore_versions     "my version" cocktails, owned by the account id (guest or member)
--   discover_explore_events       raw anonymous taps/changes; written ONLY with aggregate_research consent
--   discover_explore_export_log   which finished weeks were already sent to PHG main
-- Functions (security definer, search_path '', service role only):
--   discover_explore_save_version  save with a per-account cap, race-safe
--   discover_explore_pending_weeks / discover_explore_weekly_export  combined rows, privacy cut-off applied
--   discover_explore_mark_week_sent, discover_explore_cleanup (also removes build markers older than 1 day)
--   discover_explore_journey_build_claim / _release  one build per Journey at a time, so a guest's re-polling does not burn their daily builds
--   discover_guest_refund  gives back a reserved guest Journey build when no build actually started (PHG said none / failed)
-- Changes to existing objects (nothing else is touched):
--   * discover_guest_usage kind check + discover_guest_allow: kinds menu_link, cocktail_change, journey_build added
--     (same signature and logic as PR #127).
--   * discover_delete_subject_data: same as live, plus deletes the subject's versions and events (delete-my-data path).
--     Menu link cache rows go with their menu_observations row (ON DELETE CASCADE).
-- Privacy cut-off: a weekly row leaves Discover only when it has >= 5 distinct people (never below 3). Rows below are dropped.
-- Raw events: kept 90 days, or 30 days after their week was sent, whichever is sooner.

create table if not exists public.discover_explore_menu_links (
  observation_id uuid primary key references public.menu_observations(id) on delete cascade,
  consumer_id uuid not null,
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  created_at timestamptz not null default now()
);

create table if not exists public.discover_explore_journeys (
  item_kind text not null check (item_kind in ('cocktail', 'spirit', 'wine', 'beer', 'other')),
  item_ref text not null check (char_length(item_ref) between 1 and 120),
  status text not null check (status in ('ready', 'built')),
  journey jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (item_kind, item_ref)
);

-- In-flight Journey build marker. Global per Journey, holds no person id. A marker older than the hold is taken over.
create table if not exists public.discover_explore_journey_builds (
  item_kind text not null check (item_kind in ('cocktail', 'spirit', 'wine', 'beer', 'other')),
  item_ref text not null check (char_length(item_ref) between 1 and 120),
  started_at timestamptz not null default now(),
  primary key (item_kind, item_ref)
);

create table if not exists public.discover_explore_versions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  recipe jsonb not null,
  bartender_card text not null default '',
  home_recipe text not null default '',
  base_cocktail_id text,
  change_types text[] not null default '{}',
  observation_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists discover_explore_versions_subject_idx on public.discover_explore_versions (subject_id, created_at desc);

create table if not exists public.discover_explore_events (
  id bigint generated always as identity primary key,
  subject_id uuid not null,           -- only for delete-my-data and distinct counting; never exported
  venue_id uuid,
  occurred_at timestamptz not null default now(),
  item_kind text not null check (item_kind in ('cocktail', 'spirit', 'wine', 'beer', 'other')),
  item_ref text not null check (char_length(item_ref) between 1 and 120),
  event text not null check (event in ('tap', 'journey_open', 'change', 'save_my_version')),
  change_type text check (change_type is null or change_type in
    ('swap_base','smokier','lower_proof','stronger','sweeter','drier','more_citrus','less_ice','no_alcohol','other'))
);
create index if not exists discover_explore_events_week_idx on public.discover_explore_events (occurred_at);
create index if not exists discover_explore_events_subject_idx on public.discover_explore_events (subject_id);

create table if not exists public.discover_explore_export_log (
  week_start date primary key,
  sent_at timestamptz not null default now(),
  rows_sent integer not null default 0,
  rows_dropped integer not null default 0
);

alter table public.discover_explore_menu_links enable row level security;
alter table public.discover_explore_journeys enable row level security;
alter table public.discover_explore_journey_builds enable row level security;
alter table public.discover_explore_versions enable row level security;
alter table public.discover_explore_events enable row level security;
alter table public.discover_explore_export_log enable row level security;
revoke all on table public.discover_explore_menu_links, public.discover_explore_journeys, public.discover_explore_journey_builds, public.discover_explore_versions,
  public.discover_explore_events, public.discover_explore_export_log from public, anon, authenticated;
grant select, insert, update, delete on table public.discover_explore_menu_links, public.discover_explore_journeys,
  public.discover_explore_journey_builds, public.discover_explore_versions, public.discover_explore_events, public.discover_explore_export_log to service_role;
grant usage, select on sequence public.discover_explore_events_id_seq to service_role;
comment on table public.discover_explore_events is
  'P-20261123-0711: raw tap/change events, only for subjects with aggregate_research consent. subject_id is for deletion and distinct counting only. 90-day / sent+30-day retention via discover_explore_cleanup().';

-- Save "my version" with a cap per account; returns the new id, or null when the account is at its cap.
create or replace function public.discover_explore_save_version(
  p_subject uuid, p_max integer, p_name text, p_recipe jsonb, p_card text, p_home text,
  p_base text, p_changes text[], p_observation uuid)
returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; v_n integer;
begin
  if p_subject is null or p_max is null or p_max < 1 then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('discover-explore-versions:' || p_subject::text, 0));
  select count(*) into v_n from public.discover_explore_versions where subject_id = p_subject;
  if v_n >= p_max then return null; end if;
  insert into public.discover_explore_versions (subject_id, name, recipe, bartender_card, home_recipe, base_cocktail_id, change_types, observation_id)
  values (p_subject, p_name, p_recipe, coalesce(p_card, ''), coalesce(p_home, ''), p_base, coalesce(p_changes, '{}'), p_observation)
  returning id into v_id;
  return v_id;
end
$function$;

-- Finished weeks (Monday UTC) that still have raw events and were not sent yet.
create or replace function public.discover_explore_pending_weeks()
returns table (week_start date)
language sql stable security definer set search_path to ''
as $function$
  select distinct (date_trunc('week', e.occurred_at at time zone 'utc'))::date as week_start
  from public.discover_explore_events e
  where (date_trunc('week', e.occurred_at at time zone 'utc'))::date < (date_trunc('week', now() at time zone 'utc'))::date
    and not exists (select 1 from public.discover_explore_export_log l
                    where l.week_start = (date_trunc('week', e.occurred_at at time zone 'utc'))::date)
  order by 1
  limit 8;
$function$;

-- Combined rows only. No subject, device or session IDs. A row needs >= p_min_guests distinct people (floor 3).
-- Events of people whose aggregate_research consent is no longer granted are excluded at export time as well.
create or replace function public.discover_explore_weekly_export(p_min_guests integer default 5)
returns table (venue_id uuid, week_start date, item_kind text, item_ref text, event text, change_type text, count bigint, guests bigint)
language sql stable security definer set search_path to ''
as $function$
  with weeks as (select w.week_start from public.discover_explore_pending_weeks() w),
  ok as (
    select s.subject_id from (select distinct e.subject_id from public.discover_explore_events e) s
    where (select c.aggregate_research from public.learning_current_consent(s.subject_id) c)
  )
  select e.venue_id, (date_trunc('week', e.occurred_at at time zone 'utc'))::date, e.item_kind, e.item_ref, e.event, e.change_type,
         count(*)::bigint, count(distinct e.subject_id)::bigint
  from public.discover_explore_events e
  join weeks w on w.week_start = (date_trunc('week', e.occurred_at at time zone 'utc'))::date
  join ok on ok.subject_id = e.subject_id
  group by 1, 2, 3, 4, 5, 6
  having count(distinct e.subject_id) >= greatest(coalesce(p_min_guests, 5), 3)
  order by 2, 1, 3, 4, 5, 6;
$function$;

create or replace function public.discover_explore_mark_week_sent(p_week date, p_rows_sent integer, p_min_guests integer default 5)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_groups integer;
begin
  select count(*) into v_groups from (
    select 1 from public.discover_explore_events e
    where (date_trunc('week', e.occurred_at at time zone 'utc'))::date = p_week
    group by e.venue_id, e.item_kind, e.item_ref, e.event, e.change_type) g;
  insert into public.discover_explore_export_log (week_start, rows_sent, rows_dropped)
  values (p_week, greatest(p_rows_sent, 0), greatest(v_groups - greatest(p_rows_sent, 0), 0))
  on conflict (week_start) do nothing;
end
$function$;

create or replace function public.discover_explore_cleanup()
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare n_ev integer; n_links integer; n_j integer; n_b integer;
begin
  delete from public.discover_explore_events e
  where e.occurred_at < now() - interval '90 days'
     or exists (select 1 from public.discover_explore_export_log l
                where l.week_start = (date_trunc('week', e.occurred_at at time zone 'utc'))::date
                  and l.sent_at < now() - interval '30 days');
  get diagnostics n_ev = row_count;
  delete from public.discover_explore_menu_links where created_at < now() - interval '30 days';
  get diagnostics n_links = row_count;
  delete from public.discover_explore_journeys where fetched_at < now() - interval '30 days';
  get diagnostics n_j = row_count;
  delete from public.discover_explore_journey_builds where started_at < now() - interval '1 day';
  get diagnostics n_b = row_count;
  return jsonb_build_object('events', n_ev, 'menu_links', n_links, 'journeys', n_j, 'journey_builds', n_b);
end
$function$;

-- One build per Journey at a time. true = you may build now (no marker, or the marker is older than p_hold_seconds and is taken over);
-- false = a fresh marker exists, so a build is already running. A single insert ... on conflict statement: race-safe, no lock needed.
create or replace function public.discover_explore_journey_build_claim(p_item_kind text, p_item_ref text, p_hold_seconds integer)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare v_started timestamptz;
begin
  if p_item_kind is null or p_item_ref is null or p_hold_seconds is null or p_hold_seconds < 0 or p_hold_seconds > 86400 then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;
  insert into public.discover_explore_journey_builds as b (item_kind, item_ref, started_at)
  values (p_item_kind, p_item_ref, pg_catalog.clock_timestamp())
  on conflict (item_kind, item_ref) do update set started_at = excluded.started_at
    where b.started_at < pg_catalog.clock_timestamp() - pg_catalog.make_interval(secs => p_hold_seconds)
  returning b.started_at into v_started;
  return v_started is not null;
end
$function$;

create or replace function public.discover_explore_journey_build_release(p_item_kind text, p_item_ref text)
returns void
language sql security definer set search_path to ''
as $function$
  delete from public.discover_explore_journey_builds where item_kind = p_item_kind and item_ref = p_item_ref;
$function$;

revoke all on function public.discover_explore_save_version(uuid, integer, text, jsonb, text, text, text, text[], uuid) from public, anon, authenticated;
revoke all on function public.discover_explore_pending_weeks() from public, anon, authenticated;
revoke all on function public.discover_explore_weekly_export(integer) from public, anon, authenticated;
revoke all on function public.discover_explore_mark_week_sent(date, integer, integer) from public, anon, authenticated;
revoke all on function public.discover_explore_cleanup() from public, anon, authenticated;
grant execute on function public.discover_explore_save_version(uuid, integer, text, jsonb, text, text, text, text[], uuid) to service_role;
grant execute on function public.discover_explore_pending_weeks() to service_role;
grant execute on function public.discover_explore_weekly_export(integer) to service_role;
grant execute on function public.discover_explore_mark_week_sent(date, integer, integer) to service_role;
grant execute on function public.discover_explore_cleanup() to service_role;
revoke all on function public.discover_explore_journey_build_claim(text, text, integer) from public, anon, authenticated;
revoke all on function public.discover_explore_journey_build_release(text, text) from public, anon, authenticated;
grant execute on function public.discover_explore_journey_build_claim(text, text, integer) to service_role;
grant execute on function public.discover_explore_journey_build_release(text, text) to service_role;

-- Guest limits: add the three new kinds. Same signature and logic as PR #127.
alter table public.discover_guest_usage drop constraint if exists discover_guest_usage_kind_check;
alter table public.discover_guest_usage add constraint discover_guest_usage_kind_check
  check (kind in ('images', 'menu_pages', 'autosave', 'bottle_save', 'menu_link', 'cocktail_change', 'journey_build'));

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
     or p_kind not in ('images', 'menu_pages', 'autosave', 'bottle_save', 'menu_link', 'cocktail_change', 'journey_build') then
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

-- Give back units reserved by discover_guest_allow when the paid work never started. Today's rows only, never below 0.
-- Limited to journey_build (the only caller). Same advisory lock as discover_guest_allow so it cannot race a reservation.
create or replace function public.discover_guest_refund(
  p_account uuid, p_network uuid, p_kind text, p_units integer)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  if p_account is null or p_kind is null or p_units is null or p_units < 1 or p_units > 50
     or p_kind not in ('journey_build') then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('discover-guest:' || p_kind || ':' || v_day::text, 0)
  );
  update public.discover_guest_usage set units = greatest(units - p_units, 0)
  where day = v_day and kind = p_kind and key_kind = 'account' and key_id = p_account;
  if p_network is not null then
    update public.discover_guest_usage set units = greatest(units - p_units, 0)
    where day = v_day and kind = p_kind and key_kind = 'network' and key_id = p_network;
  end if;
  return true;
end
$function$;

revoke all on function public.discover_guest_refund(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.discover_guest_refund(uuid, uuid, text, integer) to service_role;

-- Delete-my-data: identical to the live function plus the two personal tap-to-explore tables.
create or replace function public.discover_delete_subject_data(p_subject uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n_events int; n_consent int; n_profiles int; n_observations int; n_versions int; n_explore int;
begin
  if p_subject is null then raise exception 'invalid_subject' using errcode = '22023'; end if;
  perform public.learning_subject_lock(p_subject);
  delete from public.learning_question_records where subject_id = p_subject;
  delete from public.learning_events where subject_id = p_subject;            get diagnostics n_events = row_count;
  delete from public.learning_consent_records where subject_id = p_subject;   get diagnostics n_consent = row_count;
  delete from public.personal_taste_profiles where subject_id = p_subject;    get diagnostics n_profiles = row_count;
  delete from public.discover_explore_versions where subject_id = p_subject;  get diagnostics n_versions = row_count;
  delete from public.discover_explore_events where subject_id = p_subject;    get diagnostics n_explore = row_count;
  delete from public.menu_observations where consumer_id = p_subject;         get diagnostics n_observations = row_count;  -- cascades assets, jobs, extractions, processing events, explore menu links
  return jsonb_build_object('learning_events', n_events, 'consent_records', n_consent, 'taste_profiles', n_profiles, 'menu_observations', n_observations,
                            'explore_versions', n_versions, 'explore_events', n_explore);
end $$;
revoke all on function public.discover_delete_subject_data(uuid) from public, anon, authenticated;
grant execute on function public.discover_delete_subject_data(uuid) to service_role;

-- OPTIONAL weekly job (NOT created here; the manager decides). Monday 03:17 UTC, calls the program with the worker secret.
-- Needs the secret stored in vault as 'discover_explore_worker_secret' and the same value set as DISCOVER_EXPLORE_WORKER_SECRET.
-- select cron.schedule('discover-explore-weekly-counts', '17 3 * * 1', $job$
--   select net.http_post(
--     url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-explore',
--     headers := jsonb_build_object('content-type', 'application/json',
--       'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discover_explore_worker_secret')),
--     body := '{"action":"push_counts"}'::jsonb) $job$);
