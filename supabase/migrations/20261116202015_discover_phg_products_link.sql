-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116202015 "discover_phg_products_link" was applied live but was never committed to the repo.
create extension if not exists unaccent with schema extensions;

create or replace function public.discover_norm(p text) returns text language sql immutable set search_path = public, extensions as $$
  select trim(regexp_replace(regexp_replace(lower(extensions.unaccent(coalesce(p,''))), '[''’`.]', '', 'g'), '[^a-z0-9]+', ' ', 'g'))
$$;

create table if not exists public.discover_phg_products (
  phg_product_id uuid primary key,
  phg_code text not null,
  phg_brand_id uuid,
  brand text, brand_aliases text[], name text,
  class text, size_ml numeric, abv numeric, upcs text[], ttb_id text, status text,
  category_phg_id uuid, category text, category_path text,
  label_tier text, producer text, producer_city text, producer_state text, origin text, label_class text, country text,
  brand_norm text generated always as (public.discover_norm(brand)) stored,
  name_norm text generated always as (public.discover_norm(name)) stored,
  synced_at timestamptz not null default now()
);
comment on table public.discover_phg_products is 'Daily copy of Harmony (PHG) product facts for the scanner. PHG stays canonical.';
create index if not exists discover_phg_products_brand on public.discover_phg_products (brand_norm);
create index if not exists discover_phg_products_upcs on public.discover_phg_products using gin (upcs);
alter table public.discover_phg_products enable row level security;
revoke all on public.discover_phg_products from anon, authenticated;

create table if not exists public.discover_phg_brand_profiles (
  phg_brand_id uuid primary key, brand text, version int, ten_second text, thirty_second text,
  history jsonb, producer jsonb, production jsonb, style jsonb, pronunciation text,
  synced_at timestamptz not null default now()
);
comment on table public.discover_phg_brand_profiles is 'Approved Harmony brand profiles (human-reviewed), copied daily for scanner cards.';
alter table public.discover_phg_brand_profiles enable row level security;
revoke all on public.discover_phg_brand_profiles from anon, authenticated;

alter table public.discover_products add column if not exists phg_link_method text, add column if not exists phg_link_score numeric, add column if not exists phg_linked_at timestamptz;

create or replace function public.discover_phg_products_load(p_rows jsonb, p_replace boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_replace then delete from public.discover_phg_products where synced_at < now() - interval '1 minute'; end if;
  insert into public.discover_phg_products(phg_product_id, phg_code, phg_brand_id, brand, brand_aliases, name, class, size_ml, abv, upcs, ttb_id, status,
     category_phg_id, category, category_path, label_tier, producer, producer_city, producer_state, origin, label_class, country, synced_at)
  select (r->>'id')::uuid, r->>'code', nullif(r->>'brand_id','')::uuid, r->>'brand',
     case when jsonb_typeof(r->'aliases')='array' then array(select jsonb_array_elements_text(r->'aliases')) end,
     r->>'name', r->>'class', nullif(r->>'size_ml','')::numeric, nullif(r->>'abv','')::numeric,
     case when jsonb_typeof(r->'upcs')='array' then array(select jsonb_array_elements_text(r->'upcs')) end,
     r->>'ttb', r->>'status', nullif(r->>'category_id','')::uuid, r->>'category', r->>'category_path', r->>'tier', r->>'producer',
     r->>'producer_city', r->>'producer_state', r->>'origin', r->>'label_class', r->>'country', now()
  from jsonb_array_elements(p_rows) r
  on conflict (phg_product_id) do update set phg_code=excluded.phg_code, phg_brand_id=excluded.phg_brand_id, brand=excluded.brand, brand_aliases=excluded.brand_aliases,
     name=excluded.name, class=excluded.class, size_ml=excluded.size_ml, abv=excluded.abv, upcs=excluded.upcs, ttb_id=excluded.ttb_id, status=excluded.status,
     category_phg_id=excluded.category_phg_id, category=excluded.category, category_path=excluded.category_path, label_tier=excluded.label_tier,
     producer=excluded.producer, producer_city=excluded.producer_city, producer_state=excluded.producer_state, origin=excluded.origin,
     label_class=excluded.label_class, country=excluded.country, synced_at=now();
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.discover_phg_products_load(jsonb, boolean) from public, anon, authenticated;

create or replace function public.discover_phg_profiles_load(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.discover_phg_brand_profiles;
  insert into public.discover_phg_brand_profiles(phg_brand_id, brand, version, ten_second, thirty_second, history, producer, production, style, pronunciation)
  select (r->>'brand_id')::uuid, r->>'brand', (r->>'version')::int, r->>'ten_second', r->>'thirty_second', r->'history', r->'producer', r->'production', r->'style', r->>'pronunciation'
  from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.discover_phg_profiles_load(jsonb) from public, anon, authenticated;
