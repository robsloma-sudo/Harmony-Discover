-- Harmony Discover DEV: venue check-ins after a scan, and a public per-venue feed of what people have scanned there.
-- Venues are Harmony Atlas records (same layers/keys as Harmony Atlas: venues, licences, stores, distill, wineries,
-- breweries), referenced as '<layer>:<atlas key>' and mirrored into discover_venues with source_provider 'phg_atlas'.
--
-- Discover DEV (lqqmwqrffelgnbngrkep) only; applied 2026-11-16 with Rob's approval. Never apply to Harmony production.
--
-- Privacy rules built into the schema:
--  * A check-in stores the venue the person CHOSE, the rounded distance and the GPS accuracy. It never stores the
--    person's latitude/longitude (there is no column for it).
--  * Nothing is shared publicly unless the person ticked "share what I scan here" on that check-in (share_scans).
--  * The public feed returns product names, counts and dates only: no user ids, no label photos, no free text.
--  * A check-in can be withdrawn; withdrawn check-ins stop contributing to the feed immediately.

-- 1. Liquor / wine stores become a first-class venue type (they come from PHG off-premise licences).
alter table public.discover_venues drop constraint if exists discover_venues_venue_type_check;
alter table public.discover_venues add constraint discover_venues_venue_type_check
  check (venue_type in ('bar','restaurant','brewery','winery','distillery','cocktail_bar','hotel','liquor_store','other'));

-- 2. Check-ins.
create table if not exists public.discover_venue_checkins (
  id uuid primary key default gen_random_uuid(),
  consumer_id uuid not null references auth.users(id) on delete cascade,
  venue_id uuid not null references public.discover_venues(id) on delete cascade,
  trigger_kind text not null check (trigger_kind in ('bottle_scan','menu_scan','live_scan','manual')),
  selection text not null check (selection in ('suggested','chosen_from_list','searched')),
  distance_m integer not null check (distance_m between 0 and 300),
  accuracy_m integer not null check (accuracy_m between 0 and 400),
  share_scans boolean not null default false,
  checked_in_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '90 minutes',
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > checked_in_at and expires_at <= checked_in_at + interval '6 hours')
);
create index if not exists discover_venue_checkins_consumer_active_idx
  on public.discover_venue_checkins(consumer_id, checked_in_at desc) where withdrawn_at is null;
create index if not exists discover_venue_checkins_venue_idx
  on public.discover_venue_checkins(venue_id, checked_in_at desc) where withdrawn_at is null;

alter table public.discover_venue_checkins enable row level security;
drop policy if exists "consumer reads own checkins" on public.discover_venue_checkins;
create policy "consumer reads own checkins" on public.discover_venue_checkins
  for select to authenticated using ((select auth.uid()) = consumer_id);
revoke all on public.discover_venue_checkins from anon, authenticated;
grant select on public.discover_venue_checkins to authenticated;

-- 3. Scans remember which check-in they were taken under.
alter table public.bottle_sightings add column if not exists venue_checkin_id uuid
  references public.discover_venue_checkins(id) on delete set null;
alter table public.menu_observations add column if not exists venue_checkin_id uuid
  references public.discover_venue_checkins(id) on delete set null;
create index if not exists bottle_sightings_venue_checkin_idx on public.bottle_sightings(venue_checkin_id) where venue_checkin_id is not null;
create index if not exists bottle_sightings_venue_idx on public.bottle_sightings(venue_id, seen_at desc) where venue_id is not null;
create index if not exists menu_observations_venue_checkin_idx on public.menu_observations(venue_checkin_id) where venue_checkin_id is not null;

-- The caller's active check-in (latest, not expired, not withdrawn).
create or replace function public.discover_active_checkin(p_subject uuid)
returns public.discover_venue_checkins
language sql stable security definer
set search_path to pg_catalog, public
as $$
  select c.* from public.discover_venue_checkins c
  where c.consumer_id = p_subject and c.withdrawn_at is null and c.expires_at > now()
  order by c.checked_in_at desc limit 1;
$$;
revoke all on function public.discover_active_checkin(uuid) from public, anon, authenticated;
grant execute on function public.discover_active_checkin(uuid) to service_role;

-- Scans saved while checked in are tagged automatically, so no scanner/save code path has to change.
-- An explicit venue_id from the caller is never overwritten.
create or replace function public.discover_tag_scan_with_checkin()
returns trigger
language plpgsql security definer
set search_path to pg_catalog, public
as $$
declare c public.discover_venue_checkins;
begin
  if new.consumer_id is null or new.venue_id is not null or new.venue_checkin_id is not null then return new; end if;
  c := public.discover_active_checkin(new.consumer_id);
  if c.id is not null then
    new.venue_checkin_id := c.id;
    new.venue_id := c.venue_id;
  end if;
  return new;
end $$;
revoke all on function public.discover_tag_scan_with_checkin() from public, anon, authenticated;

drop trigger if exists discover_tag_bottle_sighting_with_checkin on public.bottle_sightings;
create trigger discover_tag_bottle_sighting_with_checkin before insert on public.bottle_sightings
  for each row execute function public.discover_tag_scan_with_checkin();
drop trigger if exists discover_tag_menu_observation_with_checkin on public.menu_observations;
create trigger discover_tag_menu_observation_with_checkin before insert on public.menu_observations
  for each row execute function public.discover_tag_scan_with_checkin();

-- 4. Record a confirmed check-in. Called only by discover-checkins (service role) AFTER it has verified the venue against the
--    PHG Atlas public bridge and computed the distance itself. Upserts the Discover-owned copy of the public venue.
create or replace function public.discover_checkin_record(
  p_subject uuid,
  p_source_ref text,
  p_name text,
  p_venue_type text,
  p_latitude double precision,
  p_longitude double precision,
  p_address_line text,
  p_locality text,
  p_region text,
  p_postal_code text,
  p_trigger text,
  p_selection text,
  p_distance_m integer,
  p_accuracy_m integer,
  p_share_scans boolean,
  p_attach_recent_minutes integer default 10
) returns jsonb
language plpgsql security definer
set search_path to pg_catalog, public
as $$
declare
  v_venue uuid; v_checkin uuid; v_attached_bottles integer := 0; v_attached_menus integer := 0; v_recent integer;
begin
  if p_subject is null then raise exception 'subject_required' using errcode = '22023'; end if;
  if p_source_ref is null or p_source_ref !~ '^(venues|licences|stores|distill|wineries|breweries):[^[:cntrl:]]{1,200}$' then
    raise exception 'invalid_source_ref' using errcode = '22023';
  end if;
  if p_attach_recent_minutes is null or p_attach_recent_minutes not between 0 and 30 then
    raise exception 'invalid_attach_window' using errcode = '22023';
  end if;

  -- Abuse guard: at most 12 check-ins per person per hour.
  select count(*) into v_recent from public.discover_venue_checkins
   where consumer_id = p_subject and created_at > now() - interval '1 hour';
  if v_recent >= 12 then raise exception 'checkin_rate_limited' using errcode = 'P0001'; end if;

  insert into public.discover_venues(name, venue_type, address_line, locality, region, postal_code, latitude, longitude,
    source_provider, source_place_id, verification_status)
  values (left(trim(p_name), 180), p_venue_type, nullif(trim(p_address_line), ''), nullif(trim(p_locality), ''),
    nullif(trim(p_region), ''), nullif(trim(p_postal_code), ''), p_latitude, p_longitude,
    'phg_atlas', p_source_ref, 'source_verified')
  on conflict (source_provider, source_place_id) do update
    set name = excluded.name, venue_type = excluded.venue_type, address_line = excluded.address_line,
        locality = excluded.locality, region = excluded.region, postal_code = excluded.postal_code,
        latitude = excluded.latitude, longitude = excluded.longitude, updated_at = now()
  returning id into v_venue;

  -- One active check-in at a time: close the previous one.
  update public.discover_venue_checkins set expires_at = greatest(checked_in_at + interval '1 microsecond', clock_timestamp())
   where consumer_id = p_subject and withdrawn_at is null and expires_at > now();

  insert into public.discover_venue_checkins(consumer_id, venue_id, trigger_kind, selection, distance_m, accuracy_m, share_scans)
  values (p_subject, v_venue, p_trigger, p_selection, p_distance_m, p_accuracy_m, coalesce(p_share_scans, false))
  returning id into v_checkin;

  -- The scan that triggered the prompt was usually saved a moment BEFORE the person confirmed.
  if p_attach_recent_minutes > 0 then
    update public.bottle_sightings set venue_id = v_venue, venue_checkin_id = v_checkin
     where consumer_id = p_subject and venue_id is null and venue_checkin_id is null
       and created_at > now() - make_interval(mins => p_attach_recent_minutes);
    get diagnostics v_attached_bottles = row_count;
    update public.menu_observations set venue_id = v_venue, venue_checkin_id = v_checkin
     where consumer_id = p_subject and venue_id is null and venue_checkin_id is null
       and created_at > now() - make_interval(mins => p_attach_recent_minutes);
    get diagnostics v_attached_menus = row_count;
  end if;

  return jsonb_build_object('checkin_id', v_checkin, 'venue_id', v_venue,
    'expires_at', (select expires_at from public.discover_venue_checkins where id = v_checkin),
    'attached_bottles', v_attached_bottles, 'attached_menus', v_attached_menus);
end $$;
revoke all on function public.discover_checkin_record(uuid,text,text,text,double precision,double precision,text,text,text,text,text,text,integer,integer,boolean,integer) from public, anon, authenticated;
grant execute on function public.discover_checkin_record(uuid,text,text,text,double precision,double precision,text,text,text,text,text,text,integer,integer,boolean,integer) to service_role;

-- Withdraw: the check-in stops tagging scans and its scans leave the public feed.
create or replace function public.discover_checkin_withdraw(p_subject uuid, p_checkin uuid)
returns boolean
language sql security definer
set search_path to pg_catalog, public
as $$
  with w as (
    update public.discover_venue_checkins set withdrawn_at = now(), share_scans = false
     where id = p_checkin and consumer_id = p_subject and withdrawn_at is null
    returning id)
  select exists(select 1 from w);
$$;
revoke all on function public.discover_checkin_withdraw(uuid,uuid) from public, anon, authenticated;
grant execute on function public.discover_checkin_withdraw(uuid,uuid) to service_role;

-- 5. Public per-venue feed (crowd-sourced, aggregated, anonymous).
--    Bottles: only from shared, non-withdrawn check-ins, only confident reads, never 'rejected' evidence.
--    Menus: only observations with an active contribution grant (the existing menu consent model).
create or replace function public.discover_venue_public_feed(p_source_ref text, p_days integer default 90)
returns jsonb
language plpgsql stable security definer
set search_path to pg_catalog, public
as $$
declare v public.discover_venues; v_days integer := least(greatest(coalesce(p_days, 90), 1), 365); v_bottles jsonb; v_menus jsonb; v_people integer;
begin
  select * into v from public.discover_venues
   where source_provider = 'phg_atlas' and source_place_id = p_source_ref and is_active and verification_status <> 'rejected';
  if v.id is null then
    return jsonb_build_object('venue', null, 'bottles', '[]'::jsonb, 'menus', '[]'::jsonb, 'contributors', 0, 'window_days', v_days);
  end if;

  select coalesce(jsonb_agg(b order by b->>'last_seen_at' desc), '[]'::jsonb) into v_bottles from (
    select jsonb_build_object(
      'brand', min(s.read_brand), 'product', min(s.read_product), 'category', min(s.read_category),
      'size', min(s.read_size), 'last_seen_at', max(s.seen_at), 'first_seen_at', min(s.seen_at),
      'sightings', count(*), 'people', count(distinct s.consumer_id),
      'catalogue_product_id', min(s.discover_product_id::text)) b
    from public.bottle_sightings s
    join public.discover_venue_checkins c on c.id = s.venue_checkin_id
    where s.venue_id = v.id and c.share_scans and c.withdrawn_at is null
      and coalesce(s.evidence_state, 'reported') <> 'rejected'
      and coalesce(s.read_confidence, 0) >= 0.78
      and nullif(trim(s.read_brand), '') is not null
      and s.seen_at > now() - make_interval(days => v_days)
    group by lower(trim(s.read_brand)), lower(coalesce(trim(s.read_product), '')), lower(coalesce(trim(s.read_size), ''))
    limit 300) x;

  select coalesce(jsonb_agg(m order by m->>'captured_at' desc), '[]'::jsonb) into v_menus from (
    select jsonb_build_object('observation_id', o.id, 'captured_at', coalesce(o.captured_at, o.created_at),
      'items', (select coalesce(jsonb_agg(jsonb_build_object('section', i.section, 'name', i.name, 'price', i.price_text,
                  'category', i.beverage_category) order by i.page_index, i.position), '[]'::jsonb)
                from public.observation_items i where i.observation_id = o.id)) m
    from public.menu_observations o
    where o.venue_id = v.id and o.status in ('ready_for_review','complete')
      and exists (select 1 from public.observation_contribution_grants g
                   where g.observation_id = o.id and g.withdrawn_at is null)
      and coalesce(o.captured_at, o.created_at) > now() - make_interval(days => v_days)
    order by coalesce(o.captured_at, o.created_at) desc
    limit 10) y;

  select count(distinct c.consumer_id) into v_people from public.discover_venue_checkins c
   where c.venue_id = v.id and c.share_scans and c.withdrawn_at is null
     and c.checked_in_at > now() - make_interval(days => v_days);

  return jsonb_build_object(
    'venue', jsonb_build_object('ref', v.source_place_id, 'name', v.name, 'venue_type', v.venue_type,
      'locality', v.locality, 'region', v.region, 'latitude', v.latitude, 'longitude', v.longitude),
    'bottles', v_bottles, 'menus', v_menus, 'contributors', v_people, 'window_days', v_days,
    'note', 'Crowd-sourced from Discover scans. Shows what people saw here recently, not a stock guarantee.');
end $$;
revoke all on function public.discover_venue_public_feed(text,integer) from public, anon, authenticated;
grant execute on function public.discover_venue_public_feed(text,integer) to service_role;

comment on table public.discover_venue_checkins is
  'Venue the person confirmed after a scan. Stores rounded distance and GPS accuracy only, never the person''s coordinates. share_scans gates the public venue feed.';
comment on function public.discover_venue_public_feed(text,integer) is
  'Anonymous aggregate of shared bottle sightings and consented menu reads at one PHG Atlas venue. No user ids, no images.';
