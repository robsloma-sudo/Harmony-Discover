-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116164731 "discover_phg_cola_staging" was applied live but was never committed to the repo.
-- Staging copy of PHG unknown-product -> COLA label links (computed read-only in PHG; PHG unchanged).
create table if not exists public.discover_phg_cola_import (
  chunk text primary key,
  expected_md5 text not null,
  expected_rows int not null,
  payload text not null,
  verified boolean generated always as (md5(payload) = expected_md5) stored,
  loaded_at timestamptz not null default now()
);
comment on table public.discover_phg_cola_import is 'Raw transfer chunks from PHG COLA matching run; verified by md5 before parsing.';

create table if not exists public.discover_phg_cola_brands (
  bidx int primary key,
  brand_name text not null,
  label_count int,
  first_year int,
  last_approved date,
  top_class text, top_class_pct int,
  top_origin text, top_origin_pct int,
  top_permit text, top_permit_pct int,
  staged_at timestamptz not null default now()
);
comment on table public.discover_phg_cola_brands is 'Brand-level TTB COLA facts for brands of PHG unknown products. PHG remains canonical.';

create table if not exists public.discover_phg_cola_permits (
  permit_no text primary key,
  owner_name text, operating_name text, city text, state text, industry text,
  staged_at timestamptz not null default now()
);
comment on table public.discover_phg_cola_permits is 'TTB permit holders (producers/importers) referenced by staged COLA matches.';

create table if not exists public.discover_phg_cola_products (
  phg_code text primary key,
  bidx int references public.discover_phg_cola_brands(bidx),
  tier text not null check (tier in ('strong','likely','partial','brand_only')),
  score int,
  product_name text not null,
  fanciful_name text,
  label_count int,
  first_year int,
  last_approved date,
  latest_ttb_id text,
  class_type text,
  origin text,
  permit_no text,
  abv numeric,
  volumes_ml int[],
  upc text,
  aged_years int,
  brand_established int,
  flavors text[],
  staged_at timestamptz not null default now()
);
comment on table public.discover_phg_cola_products is 'PHG unknown products linked to TTB COLA label approvals. strong/likely = same product; partial = related expression only; brand_only = brand facts only. Review before any PHG write.';
create index if not exists discover_phg_cola_products_tier_idx on public.discover_phg_cola_products(tier);

alter table public.discover_phg_cola_import enable row level security;
alter table public.discover_phg_cola_brands enable row level security;
alter table public.discover_phg_cola_permits enable row level security;
alter table public.discover_phg_cola_products enable row level security;
revoke all on public.discover_phg_cola_import, public.discover_phg_cola_brands, public.discover_phg_cola_permits, public.discover_phg_cola_products from anon, authenticated;
