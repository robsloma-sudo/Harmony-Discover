-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116191314 "discover_label_catalog" was applied live but was never committed to the repo.
create table if not exists public.discover_bridge_config (key text primary key, value text not null, updated_at timestamptz not null default now());
comment on table public.discover_bridge_config is 'Server-only settings for the PHG bridge (token, cursors). Never exposed to clients.';
alter table public.discover_bridge_config enable row level security;
revoke all on public.discover_bridge_config from anon, authenticated;

create table if not exists public.discover_label_catalog (
  ttb_id text primary key,
  brand text,
  product text,
  class_type text,
  origin text,
  permit_no text,
  approved date,
  producer text,
  phg_brand_id uuid,
  search_text text generated always as (lower(coalesce(brand,'') || ' ' || coalesce(product,''))) stored
);
comment on table public.discover_label_catalog is 'US TTB label approvals since 2016 (copied from Harmony PHG): name, style, origin, producer. Starter catalogue for instant scan name matching.';
alter table public.discover_label_catalog enable row level security;
revoke all on public.discover_label_catalog from anon, authenticated;
create extension if not exists pg_trgm;
create index if not exists discover_label_catalog_trgm on public.discover_label_catalog using gin (search_text gin_trgm_ops);
create index if not exists discover_label_catalog_brand on public.discover_label_catalog (lower(brand));

create or replace function public.discover_label_catalog_upsert(p_rows jsonb) returns int
language sql security definer set search_path = public as $$
  with ins as (
    insert into public.discover_label_catalog(ttb_id, brand, product, class_type, origin, permit_no, approved, producer, phg_brand_id)
    select r->>0, r->>1, r->>2, r->>3, r->>4, r->>5, (r->>6)::date, nullif(r->>7,''), nullif(r->>8,'')::uuid
    from jsonb_array_elements(p_rows) r
    on conflict (ttb_id) do update set brand=excluded.brand, product=excluded.product, class_type=excluded.class_type,
      origin=excluded.origin, permit_no=excluded.permit_no, approved=excluded.approved, producer=coalesce(excluded.producer, discover_label_catalog.producer),
      phg_brand_id=excluded.phg_brand_id
    returning 1)
  select count(*)::int from ins;
$$;
revoke all on function public.discover_label_catalog_upsert(jsonb) from public, anon, authenticated;
