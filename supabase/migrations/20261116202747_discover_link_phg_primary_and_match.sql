-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116202747 "discover_link_phg_primary_and_match" was applied live but was never committed to the repo.

-- Several Discover records can match one Harmony product (duplicates, other sizes). phg_product_id stays one-to-one
-- (the scan attach code relies on that); every match is kept in phg_match_product_id.
alter table public.discover_products add column if not exists phg_match_product_id uuid;
create index if not exists discover_products_phg_match_idx on public.discover_products(phg_match_product_id);

create or replace function public.discover_link_phg(p_product uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $function$
declare v_barcode int := 0; v_name int := 0; v_brand int := 0; v_primary int := 0; v_shared int := 0;
begin
  create temp table _dp on commit drop as
  select d.id, d.brand_name, d.product_name, d.upc_gtin, regexp_replace(public.discover_norm(d.brand_name), '^the ', '') bn
  from public.discover_products d
  where (p_product is null or d.id = p_product) and coalesce(d.phg_link_method,'') <> 'manual' and d.brand_name is not null;

  create temp table _bm on commit drop as
  select distinct dp.id, p.phg_brand_id
  from _dp dp join public.discover_phg_products p on
    regexp_replace(p.brand_norm, '^the ', '') = dp.bn
    or exists (select 1 from unnest(coalesce(p.brand_aliases,'{}')) a where regexp_replace(public.discover_norm(a), '^the ', '') = dp.bn)
    or (length(dp.bn) >= 5 and similarity(regexp_replace(p.brand_norm, '^the ', ''), dp.bn) >= 0.75);

  create temp table _m (id uuid primary key, phg_product_id uuid, phg_brand_id uuid, method text, score numeric) on commit drop;

  insert into _m
  select distinct on (dp.id) dp.id, p.phg_product_id, p.phg_brand_id, 'auto_barcode', 1
  from _dp dp join public.discover_phg_products p on dp.upc_gtin is not null and p.upcs @> array[dp.upc_gtin]
  order by dp.id, (p.status = 'active') desc, p.phg_code;
  get diagnostics v_barcode = row_count;

  insert into _m
  with c0 as (
    select distinct on (dp.id, p.name_norm) dp.id, p.phg_product_id, p.phg_brand_id, p.name_norm,
      public.discover_tokens(dp.product_name, string_to_array(public.discover_norm(p.brand), ' ')) dt,
      public.discover_tokens(p.name, string_to_array(public.discover_norm(p.brand), ' ')) pt
    from _dp dp join _bm bm on bm.id = dp.id join public.discover_phg_products p on p.phg_brand_id = bm.phg_brand_id
    where dp.product_name is not null and not exists (select 1 from _m where _m.id = dp.id)
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
  r as (select sc.*, row_number() over w rn, lead(score) over w runner_up from sc window w as (partition by id order by score desc))
  select id, phg_product_id, phg_brand_id, 'auto_name', round(score, 2) from r
  where rn = 1 and score >= 0.75 and (runner_up is null or score - runner_up >= 0.15);
  get diagnostics v_name = row_count;

  insert into _m
  select id, null, min(phg_brand_id::text)::uuid, 'auto_brand', null from _bm
  where not exists (select 1 from _m where _m.id = _bm.id) group by id having count(distinct phg_brand_id) = 1;
  get diagnostics v_brand = row_count;

  -- Clear old automatic links for the products being relinked, then write the new ones.
  update public.discover_products d set phg_product_id = null, phg_match_product_id = null, phg_brand_id = null,
         phg_link_method = null, phg_link_score = null, phg_linked_at = null
   where d.id in (select id from _dp) and d.phg_link_method like 'auto_%'
     and not exists (select 1 from _m where _m.id = d.id and _m.phg_product_id is not distinct from d.phg_match_product_id
                     and _m.method = d.phg_link_method);

  update public.discover_products d set phg_match_product_id = m.phg_product_id, phg_brand_id = m.phg_brand_id,
         phg_link_method = m.method, phg_link_score = m.score, phg_linked_at = coalesce(d.phg_linked_at, now())
    from _m m where d.id = m.id;

  -- One record per Harmony product holds phg_product_id: barcode beats name, then higher score, more sightings, older.
  with cand as (
    select d.id, d.phg_match_product_id pid,
           row_number() over (partition by d.phg_match_product_id
             order by (d.phg_link_method = 'manual') desc, (d.phg_link_method = 'auto_barcode') desc, d.phg_link_score desc nulls last,
                      (select count(*) from public.bottle_sightings s where s.discover_product_id = d.id) desc, d.created_at) rn
    from public.discover_products d where d.phg_match_product_id is not null),
  win as (select id, pid from cand where rn = 1)
  update public.discover_products d set phg_product_id = null
   where d.phg_product_id is not null and coalesce(d.phg_link_method,'') <> 'manual'
     and not exists (select 1 from win where win.id = d.id and win.pid = d.phg_product_id);

  with cand as (
    select d.id, d.phg_match_product_id pid,
           row_number() over (partition by d.phg_match_product_id
             order by (d.phg_link_method = 'manual') desc, (d.phg_link_method = 'auto_barcode') desc, d.phg_link_score desc nulls last,
                      (select count(*) from public.bottle_sightings s where s.discover_product_id = d.id) desc, d.created_at) rn
    from public.discover_products d where d.phg_match_product_id is not null)
  update public.discover_products d set phg_product_id = c.pid
    from cand c where c.id = d.id and c.rn = 1 and d.phg_product_id is distinct from c.pid
     and not exists (select 1 from public.discover_products o where o.phg_product_id = c.pid and o.id <> d.id);
  get diagnostics v_primary = row_count;

  select count(*) into v_shared from public.discover_products where phg_match_product_id is not null and phg_product_id is null;

  return jsonb_build_object('barcode', v_barcode, 'name', v_name, 'brand_only', v_brand, 'primary_set', v_primary, 'shared_match', v_shared);
end $function$;
revoke all on function public.discover_link_phg(uuid) from public, anon, authenticated;
