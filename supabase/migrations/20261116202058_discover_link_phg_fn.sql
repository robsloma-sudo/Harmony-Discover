-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116202058 "discover_link_phg_fn" was applied live but was never committed to the repo.
create or replace function public.discover_tokens(p text, p_drop text[] default '{}') returns text[] language sql immutable set search_path = public, extensions as $$
  select coalesce(array_agg(distinct t order by t), '{}') from unnest(string_to_array(public.discover_norm(
      regexp_replace(regexp_replace(lower(coalesce(p,'')), '(\d)\s*(yo|yr|yrs|year|years)\M', '\1', 'g'), '\mvery special\M|\mv\.?s\.?\M', 'vs', 'g')), ' ')) t
  where t <> '' and t <> all(p_drop) and t <> all(array['the','of','de','la','and','old','aged','year','years','yo','single','straight',
    'kentucky','bourbon','whiskey','whisky','tequila','vodka','gin','rum','cognac','brandy','liqueur','wine','ml','l','proof','original','edition','bottle'])
$$;

create or replace function public.discover_link_phg(p_product uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_barcode int := 0; v_name int := 0; v_brand int := 0;
begin
  create temp table _dp on commit drop as
  select d.id, d.brand_name, d.product_name, d.upc_gtin, regexp_replace(public.discover_norm(d.brand_name), '^the ', '') bn
  from public.discover_products d
  where (p_product is null or d.id = p_product) and coalesce(d.phg_link_method,'') <> 'manual' and d.brand_name is not null;

  create temp table _bm on commit drop as
  select distinct dp.id, p.phg_brand_id, p.brand
  from _dp dp join public.discover_phg_products p on
    regexp_replace(p.brand_norm, '^the ', '') = dp.bn
    or exists (select 1 from unnest(coalesce(p.brand_aliases,'{}')) a where regexp_replace(public.discover_norm(a), '^the ', '') = dp.bn)
    or (length(dp.bn) >= 5 and similarity(regexp_replace(p.brand_norm, '^the ', ''), dp.bn) >= 0.75);

  with b as (
    select distinct on (dp.id) dp.id, p.phg_product_id, p.phg_brand_id
    from _dp dp join public.discover_phg_products p on dp.upc_gtin is not null and p.upcs @> array[dp.upc_gtin]
    order by dp.id, (p.status = 'active') desc, p.phg_code)
  update public.discover_products d set phg_product_id = b.phg_product_id, phg_brand_id = b.phg_brand_id,
    phg_link_method = 'auto_barcode', phg_link_score = 1, phg_linked_at = now()
  from b where d.id = b.id;
  get diagnostics v_barcode = row_count;

  with c0 as (
    select distinct on (dp.id, p.name_norm) dp.id, p.phg_product_id, p.phg_brand_id, p.name_norm,
      public.discover_tokens(dp.product_name, string_to_array(public.discover_norm(p.brand), ' ')) dt,
      public.discover_tokens(p.name, string_to_array(public.discover_norm(p.brand), ' ')) pt
    from _dp dp join _bm bm on bm.id = dp.id join public.discover_phg_products p on p.phg_brand_id = bm.phg_brand_id
    where dp.product_name is not null
      and not exists (select 1 from public.discover_products x where x.id = dp.id and x.phg_link_method = 'auto_barcode')
    order by dp.id, p.name_norm, (p.status = 'active') desc, p.phg_code),
  s as (
    select c0.*, cardinality(array(select unnest(dt) intersect select unnest(pt))) i,
      (select array_agg(t) from unnest(dt) t where t ~ '^\d+$') dn, (select array_agg(t) from unnest(pt) t where t ~ '^\d+$') pn
    from c0),
  sc as (
    select s.*, case when cardinality(dt) = 0 and cardinality(pt) = 0 then 0.8
                     when cardinality(dt) = 0 or cardinality(pt) = 0 or i = 0 then 0
                     when dn is not null and pn is not null and not (dn && pn) then 0
                     when dn is not null and pn is null then 0
                     else 2.0 * i / (cardinality(dt) + cardinality(pt)) end score
    from s),
  r as (select sc.*, row_number() over w rn, lead(score) over w runner_up
        from sc window w as (partition by id order by score desc)),
  pick as (select id, phg_product_id, phg_brand_id, score from r where rn = 1 and score >= 0.75 and (runner_up is null or score - runner_up >= 0.15))
  update public.discover_products d set phg_product_id = pick.phg_product_id, phg_brand_id = pick.phg_brand_id,
    phg_link_method = 'auto_name', phg_link_score = round(pick.score, 2), phg_linked_at = now()
  from pick where d.id = pick.id;
  get diagnostics v_name = row_count;

  with bo as (select id, min(phg_brand_id::text)::uuid phg_brand_id from _bm group by id having count(distinct phg_brand_id) = 1)
  update public.discover_products d set phg_brand_id = bo.phg_brand_id, phg_link_method = 'auto_brand', phg_linked_at = now()
  from bo where d.id = bo.id and coalesce(d.phg_link_method,'') not in ('auto_barcode','auto_name');
  get diagnostics v_brand = row_count;

  return jsonb_build_object('barcode', v_barcode, 'name', v_name, 'brand_only', v_brand);
end $$;
revoke all on function public.discover_link_phg(uuid) from public, anon, authenticated;
