-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116203008 "discover_phg_permit_pisco_casing" was applied live but was never committed to the repo.

alter table public.discover_phg_products add column if not exists permit_no text;
alter table public.discover_kind_category_map add column if not exists reverse_ok boolean not null default true;
update public.discover_kind_category_map set reverse_ok = false where kind = 'pisco';

create or replace function public.discover_kind_for_path(p_path text) returns text
language sql stable set search_path = public as $$
  select case when p_path ~ '\.pisco_' then 'pisco' else
    (select k.kind from public.discover_kind_category_map k
      where k.reverse_ok and k.phg_path is not null and (p_path = k.phg_path or p_path like k.phg_path || '.%')
      order by length(k.phg_path) desc limit 1) end
$$;

create or replace function public.discover_company_case(p text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(initcap(p), '\mLlc\M', 'LLC', 'g'), '\mUsa\M', 'USA', 'g'), '\mLp\M', 'LP', 'g'), '\mLtd\M', 'Ltd', 'g')
$$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.discover_phg_products_load(jsonb,boolean)'::regprocedure);
  d := replace(d, 'label_class, country, synced_at)', 'label_class, country, permit_no, synced_at)');
  d := replace(d, 'r->>''label_class'', r->>''country'', now()', 'r->>''label_class'', r->>''country'', r->>''permit'', now()');
  d := replace(d, 'label_class=excluded.label_class, country=excluded.country, synced_at=now()', 'label_class=excluded.label_class, country=excluded.country, permit_no=excluded.permit_no, synced_at=now()');
  execute d;

  d := pg_get_functiondef('public.discover_prefill_from_phg(uuid)'::regprocedure);
  d := replace(d, 'initcap(producer) || coalesce(', 'public.discover_company_case(producer) || coalesce(');
  d := replace(d, 'from lp where producer is not null and label_tier in (''strong'',''likely'')',
                  'from lp where producer is not null and label_tier in (''strong'',''likely'') and permit_no is not null and (domestic = (permit_no !~ ''-I-''))');
  execute d;
end $$;
revoke all on function public.discover_phg_products_load(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.discover_prefill_from_phg(uuid) from public, anon, authenticated;
select (position('permit_no' in pg_get_functiondef('public.discover_phg_products_load(jsonb,boolean)'::regprocedure))>0) loader_ok,
       (position('domestic = (permit_no' in pg_get_functiondef('public.discover_prefill_from_phg(uuid)'::regprocedure))>0) prefill_ok,
       public.discover_kind_for_path('spirits.brandy_fruit_spirits.grape_brandy.cognac') cognac, public.discover_kind_for_path('spirits.brandy_fruit_spirits.grape_brandy.pisco_peru.puro') pisco;
