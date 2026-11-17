-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116205707 "discover_link_phg_barcodes_from_packages" was applied live but was never committed to the repo.

-- Normalised barcodes on Harmony products (GTIN check digit, leading zeros) for fast matching.
alter table public.discover_phg_products add column if not exists gtins text[];
create or replace function public.discover_phg_gtins_refresh() returns integer language sql security definer set search_path = public as $$
  with u as (update public.discover_phg_products p set gtins = (select array_agg(distinct g) from (select public.discover_gtin(x) g from unnest(p.upcs) x) z where g is not null)
             where p.upcs is not null returning 1)
  select count(*)::int from u
$$;
create index if not exists discover_phg_products_gtins_idx on public.discover_phg_products using gin (gtins);
select public.discover_phg_gtins_refresh();

do $$
declare d text;
begin
  d := pg_get_functiondef('public.discover_link_phg(uuid)'::regprocedure);
  d := replace(d, 'select d.id, d.brand_name, d.product_name, d.upc_gtin, regexp_replace(public.discover_norm(d.brand_name), ''^the '', '''') bn',
                  'select d.id, d.brand_name, d.product_name, d.upc_gtin, regexp_replace(public.discover_norm(d.brand_name), ''^the '', '''') bn,
         array(select distinct g from (select public.discover_gtin(d.upc_gtin) g union all
               select public.discover_gtin(k.upc_gtin) from public.discover_product_packages k where k.discover_product_id = d.id) z where g is not null) gtins');
  d := replace(d, 'from _dp dp join public.discover_phg_products p on dp.upc_gtin is not null and p.upcs @> array[dp.upc_gtin]',
                  'from _dp dp join public.discover_phg_products p on cardinality(dp.gtins) > 0 and p.gtins && dp.gtins');
  if position('p.gtins && dp.gtins' in d) = 0 then raise exception 'barcode clause not patched'; end if;
  execute d;
end $$;
revoke all on function public.discover_link_phg(uuid) from public, anon, authenticated;
revoke all on function public.discover_phg_gtins_refresh() from public, anon, authenticated;

-- keep gtins fresh after every catalogue load
do $$
declare d text;
begin
  d := pg_get_functiondef('public.discover_phg_products_load(jsonb,boolean)'::regprocedure);
  if position('discover_phg_gtins_refresh' in d) = 0 then
    d := replace(d, '  get diagnostics n = row_count; return n;', '  get diagnostics n = row_count;
  perform public.discover_phg_gtins_refresh();
  return n;');
    execute d;
  end if;
end $$;
revoke all on function public.discover_phg_products_load(jsonb, boolean) from public, anon, authenticated;
