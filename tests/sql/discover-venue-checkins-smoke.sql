-- Isolated PostgreSQL smoke test for venue check-ins and the public venue feed.
-- Runs against the disposable postgres service in CI (after the other smoke files) or a scratch local cluster.
-- Stubs only the parts of the DEV schema the migration touches; PostGIS is not needed here.
do $roles$ begin
  begin create role anon nologin; exception when duplicate_object then null; end;
  begin create role authenticated nologin; exception when duplicate_object then null; end;
  begin create role service_role nologin; exception when duplicate_object then null; end;
end $roles$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table if not exists public.discover_venues (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text unique,
  venue_type text not null default 'other' check (venue_type in ('bar','restaurant','brewery','winery','distillery','cocktail_bar','hotel','other')),
  description text, address_line text, locality text, region text, postal_code text, country_code text not null default 'US',
  latitude double precision not null, longitude double precision not null,
  phone text, website_url text, hero_image_url text, source_provider text, source_place_id text,
  verification_status text not null default 'unverified', is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (source_provider, source_place_id)
);
create table if not exists public.bottle_sightings (id uuid primary key);
alter table public.bottle_sightings
  add column if not exists consumer_id uuid, add column if not exists venue_id uuid,
  add column if not exists read_brand text, add column if not exists read_product text,
  add column if not exists read_category text, add column if not exists read_size text,
  add column if not exists read_confidence real, add column if not exists evidence_state text,
  add column if not exists discover_product_id uuid,
  add column if not exists seen_at timestamptz default now(), add column if not exists created_at timestamptz default now();
create table if not exists public.menu_observations (
  id uuid primary key default gen_random_uuid(), consumer_id uuid, status text, venue_id uuid,
  captured_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.observation_items (
  id uuid primary key default gen_random_uuid(), observation_id uuid, page_index integer, position integer,
  section text, name text, price_text text, beverage_category text);
create table if not exists public.observation_contribution_grants (
  id uuid primary key default gen_random_uuid(), observation_id uuid, consumer_id uuid, withdrawn_at timestamptz);

\i supabase/migrations/20261116165919_discover_venue_checkins_and_public_feed.sql

do $smoke$
declare
  u1 uuid := '61000000-0000-0000-0000-000000000001';
  u2 uuid := '61000000-0000-0000-0000-000000000002';
  u3 uuid := '61000000-0000-0000-0000-000000000003';
  r jsonb; c1 uuid; c3 uuid; v uuid; feed jsonb; s_before uuid := gen_random_uuid(); s_after uuid := gen_random_uuid();
  s_private uuid := gen_random_uuid(); s_weak uuid := gen_random_uuid(); s_old uuid := gen_random_uuid(); m uuid := gen_random_uuid();
  i integer;
begin
  insert into auth.users(id) values (u1),(u2),(u3) on conflict do nothing;

  -- liquor_store is now an allowed venue type
  insert into public.discover_venues(name, venue_type, latitude, longitude, source_provider, source_place_id)
  values ('Shop', 'liquor_store', 41.6, -93.6, 'smoke', 'shop-1');

  -- invalid refs and windows fail closed
  begin perform public.discover_checkin_record(u1,'nonsense','X','bar',41,-93,null,null,null,null,'bottle_scan','suggested',10,10,true,10);
        raise exception 'invalid ref accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.discover_checkin_record(null,'licences:IA:1','X','bar',41,-93,null,null,null,null,'bottle_scan','suggested',10,10,true,10);
        raise exception 'null subject accepted'; exception when sqlstate '22023' then null; end;
  begin perform public.discover_checkin_record(u1,'licences:IA:1','X','bar',41,-93,null,null,null,null,'bottle_scan','suggested',999,10,true,10);
        raise exception 'distance above 300 m accepted'; exception when check_violation then null; end;

  -- a scan saved just BEFORE confirming is attached to the check-in
  insert into public.bottle_sightings(id, consumer_id, read_brand, read_product, read_confidence, evidence_state, created_at, seen_at)
  values (s_before, u1, 'Michter''s', 'Barrel Strength', 0.9, 'reported', now() - interval '2 minutes', now() - interval '2 minutes');
  r := public.discover_checkin_record(u1,'venues:hall''s bar|des moines|IA','Hall''s Bar','bar',41.5868,-93.611,'1 Main','Des Moines','IA','50309',
        'bottle_scan','suggested',18,12,true,10);
  c1 := (r->>'checkin_id')::uuid; v := (r->>'venue_id')::uuid;
  if (r->>'attached_bottles')::int <> 1 then raise exception 'recent scan not attached: %', r; end if;
  if (select venue_id from public.bottle_sightings where id = s_before) is distinct from v then raise exception 'venue not set on recent scan'; end if;

  -- no coordinate columns exist on the check-in table
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='discover_venue_checkins'
             and column_name ~ '(lat|lng|lon|geo|location)') then raise exception 'check-in table must not store coordinates'; end if;

  -- a scan saved AFTER the check-in is tagged by the trigger; an explicit venue is never overwritten
  insert into public.bottle_sightings(id, consumer_id, read_brand, read_product, read_confidence, evidence_state)
  values (s_after, u1, 'Blanton''s', 'Original', 0.95, 'reported');
  if (select venue_checkin_id from public.bottle_sightings where id = s_after) is distinct from c1 then raise exception 'trigger did not tag scan'; end if;
  insert into public.bottle_sightings(id, consumer_id, venue_id, read_brand, read_confidence) values (gen_random_uuid(), u1, gen_random_uuid(), 'X', 0.9);
  if exists (select 1 from public.bottle_sightings where read_brand='X' and venue_checkin_id is not null) then raise exception 'explicit venue overwritten'; end if;

  -- a low-confidence read never reaches the public feed
  insert into public.bottle_sightings(id, consumer_id, read_brand, read_confidence, evidence_state) values (s_weak, u1, 'Blurry', 0.4, 'reported');

  -- second person, same venue, did NOT share: their scans stay private
  r := public.discover_checkin_record(u2,'venues:hall''s bar|des moines|IA','Hall''s Bar','bar',41.5868,-93.611,null,null,null,null,'menu_scan','chosen_from_list',40,30,false,0);
  insert into public.bottle_sightings(id, consumer_id, read_brand, read_confidence, evidence_state) values (s_private, u2, 'Secret Bottle', 0.95, 'reported');

  -- third person shares the same bottle -> people = 2
  r := public.discover_checkin_record(u3,'venues:hall''s bar|des moines|IA','Hall''s Bar','bar',41.5868,-93.611,null,null,null,null,'live_scan','suggested',10,8,true,0);
  c3 := (r->>'checkin_id')::uuid;
  insert into public.bottle_sightings(id, consumer_id, read_brand, read_product, read_confidence, evidence_state) values (gen_random_uuid(), u3, 'Blanton''s', 'Original', 0.9, 'reported');

  -- a consented menu read appears with its items; an unconsented one does not
  insert into public.menu_observations(id, consumer_id, status) values (m, u3, 'complete');
  insert into public.observation_items(observation_id, page_index, position, section, name, price_text) values (m, 0, 1, 'Cocktails', 'Old Fashioned', '$14');
  insert into public.observation_contribution_grants(observation_id, consumer_id) values (m, u3);
  insert into public.menu_observations(id, consumer_id, status) values (gen_random_uuid(), u3, 'complete');

  feed := public.discover_venue_public_feed('venues:hall''s bar|des moines|IA', 90);
  if feed->'venue'->>'name' <> 'Hall''s Bar' then raise exception 'feed venue wrong: %', feed; end if;
  if jsonb_array_length(feed->'bottles') <> 2 then raise exception 'expected 2 public bottles, got %', feed->'bottles'; end if;
  if feed::text like '%Secret Bottle%' then raise exception 'unshared scan leaked'; end if;
  if feed::text like '%Blurry%' then raise exception 'low-confidence read leaked'; end if;
  if feed::text like '%' || u1::text || '%' or feed::text like '%' || u3::text || '%' then raise exception 'user id leaked'; end if;
  if (select (b->>'people')::int from jsonb_array_elements(feed->'bottles') b where b->>'brand' = 'Blanton''s') <> 2 then
    raise exception 'people count wrong: %', feed->'bottles'; end if;
  if jsonb_array_length(feed->'menus') <> 1 or feed->'menus'->0->'items'->0->>'name' <> 'Old Fashioned' then raise exception 'menu feed wrong: %', feed->'menus'; end if;
  if (feed->>'contributors')::int <> 2 then raise exception 'contributors wrong: %', feed->>'contributors'; end if;

  -- withdrawing removes that person's bottles from the feed
  if not public.discover_checkin_withdraw(u3, c3) then raise exception 'withdraw failed'; end if;
  if public.discover_checkin_withdraw(u1, c3) then raise exception 'someone else withdrew a check-in'; end if;
  feed := public.discover_venue_public_feed('venues:hall''s bar|des moines|IA', 90);
  if (select (b->>'people')::int from jsonb_array_elements(feed->'bottles') b where b->>'brand' = 'Blanton''s') <> 1 then
    raise exception 'withdrawn check-in still counted'; end if;

  -- unknown venue returns an empty feed, not an error
  feed := public.discover_venue_public_feed('venues:nowhere|x|XX', 90);
  if feed->'venue' <> 'null'::jsonb or jsonb_array_length(feed->'bottles') <> 0 then raise exception 'unknown venue feed wrong'; end if;

  -- one active check-in per person
  r := public.discover_checkin_record(u1,'stores:off:IA:store-9','Store','liquor_store',41.59,-93.62,null,null,null,null,'bottle_scan','suggested',12,10,true,0);
  if (select v2.source_place_id from public.discover_venues v2 where v2.id = (public.discover_active_checkin(u1)).venue_id) <> 'stores:off:IA:store-9' then
    raise exception 'newest check-in is not the active one'; end if;
  if (select expires_at from public.discover_venue_checkins where id = c1) > clock_timestamp() then
    raise exception 'previous check-in was not closed'; end if;

  -- rate limit
  begin
    for i in 1..20 loop
      perform public.discover_checkin_record(u2,'licences:IA:'||i,'V'||i,'bar',41.59,-93.62,null,null,null,null,'manual','searched',10,10,false,0);
    end loop;
    raise exception 'rate limit not enforced';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'checkin_rate_limited' then raise; end if;
  end;

  -- privileges: only service_role may call the write/feed functions; RLS on the table
  if has_function_privilege('anon','public.discover_venue_public_feed(text,integer)','execute') then raise exception 'anon can call feed directly'; end if;
  if has_function_privilege('authenticated','public.discover_checkin_record(uuid,text,text,text,double precision,double precision,text,text,text,text,text,text,integer,integer,boolean,integer)','execute') then
    raise exception 'authenticated can record check-ins directly'; end if;
  if not (select relrowsecurity from pg_class where oid='public.discover_venue_checkins'::regclass) then raise exception 'RLS off'; end if;
  raise notice 'discover venue check-in smoke: OK';
end $smoke$;
