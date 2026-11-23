-- ROLLBACK for 20261123120000_discover_tap_to_explore.sql
-- Puts back the PR #127 guest kinds + discover_guest_allow, the pre-change discover_delete_subject_data,
-- and drops every tap-to-explore table and function. Saved "my versions" and cached data are lost (cache is rebuildable).
-- Run the discover-explore program rollback first (remove/disable the function), then this file.

drop function if exists public.discover_explore_save_version(uuid, integer, text, jsonb, text, text, text, text[], uuid);
drop function if exists public.discover_explore_weekly_export(integer);
drop function if exists public.discover_explore_pending_weeks();
drop function if exists public.discover_explore_mark_week_sent(date, integer, integer);
drop function if exists public.discover_explore_cleanup();
drop function if exists public.discover_explore_journey_build_claim(text, text, integer);
drop function if exists public.discover_explore_journey_build_release(text, text);

drop table if exists public.discover_explore_events;
drop table if exists public.discover_explore_export_log;
drop table if exists public.discover_explore_versions;
drop table if exists public.discover_explore_journey_builds;
drop table if exists public.discover_explore_journeys;
drop table if exists public.discover_explore_menu_links;

-- discover_delete_subject_data as it was before this change.
create or replace function public.discover_delete_subject_data(p_subject uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n_events int; n_consent int; n_profiles int; n_observations int;
begin
  if p_subject is null then raise exception 'invalid_subject' using errcode = '22023'; end if;
  perform public.learning_subject_lock(p_subject);
  delete from public.learning_question_records where subject_id = p_subject;
  delete from public.learning_events where subject_id = p_subject;            get diagnostics n_events = row_count;
  delete from public.learning_consent_records where subject_id = p_subject;   get diagnostics n_consent = row_count;
  delete from public.personal_taste_profiles where subject_id = p_subject;    get diagnostics n_profiles = row_count;
  delete from public.menu_observations where consumer_id = p_subject;         get diagnostics n_observations = row_count;  -- cascades assets, jobs, extractions, processing events
  return jsonb_build_object('learning_events', n_events, 'consent_records', n_consent, 'taste_profiles', n_profiles, 'menu_observations', n_observations);
end $$;
revoke all on function public.discover_delete_subject_data(uuid) from public, anon, authenticated;
grant execute on function public.discover_delete_subject_data(uuid) to service_role;

-- PR #127 guest kinds and function.
delete from public.discover_guest_usage where kind in ('menu_link', 'cocktail_change', 'journey_build');
alter table public.discover_guest_usage drop constraint if exists discover_guest_usage_kind_check;
alter table public.discover_guest_usage add constraint discover_guest_usage_kind_check
  check (kind in ('images', 'menu_pages', 'autosave', 'bottle_save'));

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
