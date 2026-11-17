-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116202405 "discover_phg_prefill_and_kind_map" was applied live but was never committed to the repo.

-- Step 4: one classification — Discover's 18 scan kinds mapped onto Harmony's category tree.
create table if not exists public.discover_kind_category_map (
  kind text primary key,
  phg_path text,
  phg_category_id uuid references public.phg_category_mirror(phg_category_id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.discover_kind_category_map enable row level security;

insert into public.discover_kind_category_map(kind, phg_path) values
 ('tequila','spirits.agave_spirits.tequila'), ('mezcal','spirits.agave_spirits.mezcal'),
 ('whiskey','spirits.whisky_whiskey'), ('vodka','spirits.vodka_neutral_grain_spirits'),
 ('gin','spirits.gin_juniper_spirits'), ('rum','spirits.rum_cane_spirits'),
 ('brandy','spirits.brandy_fruit_spirits'), ('pisco','spirits.brandy_fruit_spirits.grape_brandy'),
 ('liqueur','spirits.liqueurs_amari_bitters'), ('amaro_aperitivo','spirits.liqueurs_amari_bitters.amaro_bitter_liqueur'),
 ('vermouth','wine.aromatised_wine.vermouth'), ('wine','wine'), ('sparkling','wine.sparkling_wine'),
 ('beer','beer'), ('cider','cider'), ('non_alcoholic','alcohol_free_alternatives'),
 ('non_alcoholic_beer','beer.non_alcoholic_beer'), ('other', null)
on conflict (kind) do update set phg_path = excluded.phg_path, updated_at = now();
update public.discover_kind_category_map k set phg_category_id = m.phg_category_id
  from public.phg_category_mirror m where m.path = k.phg_path;

-- Harmony category path -> Discover kind (most specific mapped prefix wins).
create or replace function public.discover_kind_for_path(p_path text) returns text
language sql stable set search_path = public as $$
  select k.kind from public.discover_kind_category_map k
  where k.phg_path is not null and (p_path = k.phg_path or p_path like k.phg_path || '.%')
  order by length(k.phg_path) desc limit 1
$$;

create or replace function public.discover_num_txt(p numeric) returns text
language sql immutable as $$ select case when p is null then null when p = trunc(p) then trunc(p)::text else rtrim(p::text, '0') end $$;

-- Step 2: copy what Harmony already knows onto linked Discover products (empty fields only; never overwrites).
create or replace function public.discover_prefill_from_phg(p_product uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_facts int := 0; v_cat_linked int := 0; v_cat_kind int := 0; v_kind_fixed int := 0; v_conflicts int := 0;
begin
  -- Linked products take Harmony's category; unlinked ones get the category for their scan kind.
  update public.discover_products d set category_phg_id = p.category_phg_id, updated_at = now()
    from public.discover_phg_products p
   where p.phg_product_id = d.phg_product_id and p.category_phg_id is not null
     and exists (select 1 from public.phg_category_mirror m where m.phg_category_id = p.category_phg_id)
     and d.category_phg_id is distinct from p.category_phg_id and (p_product is null or d.id = p_product);
  get diagnostics v_cat_linked = row_count;

  update public.discover_products d set product_class = public.discover_kind_for_path(p.category_path), updated_at = now()
    from public.discover_phg_products p
   where p.phg_product_id = d.phg_product_id and coalesce(d.product_class, 'other') = 'other'
     and public.discover_kind_for_path(p.category_path) is not null and (p_product is null or d.id = p_product);
  get diagnostics v_kind_fixed = row_count;

  select count(*) into v_conflicts from public.discover_products d join public.discover_phg_products p on p.phg_product_id = d.phg_product_id
   where d.product_class is distinct from public.discover_kind_for_path(p.category_path) and public.discover_kind_for_path(p.category_path) is not null;

  update public.discover_products d set category_phg_id = k.phg_category_id, updated_at = now()
    from public.discover_kind_category_map k
   where d.phg_product_id is null and d.category_phg_id is null and k.kind = d.product_class and k.phg_category_id is not null
     and (p_product is null or d.id = p_product);
  get diagnostics v_cat_kind = row_count;

  create temp table _f on commit drop as
  with lp as (
    select d.id, d.product_name, p.*, (coalesce(p.country,'') ~* '^(united states|usa|us)$') domestic
    from public.discover_products d join public.discover_phg_products p on p.phg_product_id = d.phg_product_id
    where d.phg_link_method in ('auto_barcode','auto_name','manual') and (p_product is null or d.id = p_product)),
  ttb as (select lp.*, case when ttb_id ~ '^\d{8,}$' then 'https://ttbonline.gov/colasonline/viewColaDetails.do?action=publicDisplaySearchBasic&ttbid=' || ttb_id end ttb_url from lp),
  f as (
    select id, 'alcohol_statement' code,
           discover_num_txt(abv) || '% ABV' || case when category_path like 'spirits%' then ' (' || discover_num_txt(abv * 2) || ' proof)' else '' end val,
           'other' st, 'Harmony catalogue' sn, null::text su, 0.9 conf, 'corroborated' vs, phg_code from ttb where abv between 0.1 and 96
    union all
    select id, 'size', case when size_ml >= 1000 then discover_num_txt(round(size_ml / 1000.0, 3)) || ' L' else discover_num_txt(size_ml) || ' ml' end,
           'other', 'Harmony catalogue', null, 0.9, 'corroborated', phg_code from ttb where size_ml between 10 and 30000
    union all
    select id, case when domestic then 'bottler' else 'importer' end,
           initcap(producer) || coalesce(', ' || initcap(nullif(producer_city,'')), '') || coalesce(', ' || upper(nullif(producer_state,'')), ''),
           'ttb_cola', 'US label approval (TTB COLA)', ttb_url, case label_tier when 'strong' then 0.9 else 0.75 end, 'corroborated', phg_code
      from ttb where producer is not null and label_tier in ('strong','likely')
    union all
    select id, 'country', country, 'other', 'Harmony catalogue', null, 0.9, 'corroborated', phg_code from ttb where nullif(country,'') is not null
    union all
    select id, 'classification', initcap(label_class), 'ttb_cola', 'US label approval (TTB COLA)', ttb_url,
           case label_tier when 'strong' then 0.9 else 0.75 end, 'corroborated', phg_code
      from ttb where nullif(label_class,'') is not null and label_tier in ('strong','likely')
    union all
    select id, 'subcategory', category, 'other', 'Harmony category tree', null, 0.85, 'corroborated', phg_code from ttb where nullif(category,'') is not null
  )
  select * from f where val is not null;

  -- Brand story from approved Harmony brand profiles (product or brand links).
  insert into _f
  select d.id, 'history', left(array_to_string(array(select jsonb_array_elements_text(bp.history) limit 3), ' '), 1200),
         'other', 'Harmony brand profile (approved v' || bp.version || ')', null, 0.9, 'verified', null
    from public.discover_products d join public.discover_phg_brand_profiles bp on bp.phg_brand_id = d.phg_brand_id
   where d.phg_link_method in ('auto_barcode','auto_name','manual','auto_brand') and jsonb_typeof(bp.history) = 'array' and jsonb_array_length(bp.history) > 0
     and (p_product is null or d.id = p_product);

  delete from _f where exists (select 1 from public.discover_product_attributes a where a.discover_product_id = _f.id and a.attribute_code = _f.code);

  with ev as (
    insert into public.discover_product_evidence(discover_product_id, attribute_code, source_type, source_name, source_url, observed_value, confidence, verification_state, metadata)
    select id, code, st, sn, su, jsonb_build_object('value', val, 'attribute_code', code, 'product_expression', product_name), conf, vs,
           jsonb_build_object('source', 'harmony', 'phg_code', phg_code, 'supports', jsonb_build_array(code))
      from _f join (select id pid, product_name from public.discover_products) dp on dp.pid = _f.id
    returning id ev_id, discover_product_id, attribute_code)
  insert into public.discover_product_attributes(discover_product_id, attribute_code, value_text, state, confidence, evidence_id)
  select f.id, f.code, f.val, 'found', f.conf, ev.ev_id from _f f join ev on ev.discover_product_id = f.id and ev.attribute_code = f.code
  on conflict (discover_product_id, attribute_code) do nothing;
  get diagnostics v_facts = row_count;

  return jsonb_build_object('facts_added', v_facts, 'category_from_harmony', v_cat_linked, 'kind_fixed', v_kind_fixed,
                            'category_from_kind', v_cat_kind, 'kind_conflicts', v_conflicts);
end $$;

-- Step 3: Discover facts for linked products, to send back to Harmony's review table (not Harmony-sourced ones).
create or replace function public.discover_facts_for_phg(p_after timestamptz default '-infinity', p_limit int default 2000) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.updated_at), '[]'::jsonb) from (
    select distinct on (d.phg_product_id, a.attribute_code)
           d.phg_product_id product_id, a.attribute_code attribute, a.value_text value, a.confidence,
           coalesce(e.source_type, 'other') source_type, e.source_url, d.id discover_product_id, a.updated_at
      from public.discover_product_attributes a
      join public.discover_products d on d.id = a.discover_product_id
      left join public.discover_product_evidence e on e.id = a.evidence_id
     where d.phg_product_id is not null and d.phg_link_method in ('auto_barcode','auto_name','manual')
       and a.state = 'found' and nullif(a.value_text,'') is not null
       and coalesce(e.metadata->>'source','') <> 'harmony' and a.updated_at > p_after
     order by d.phg_product_id, a.attribute_code, a.confidence desc nulls last, a.updated_at desc
     limit greatest(1, least(p_limit, 5000))) x
$$;

revoke all on function public.discover_prefill_from_phg(uuid) from public, anon, authenticated;
revoke all on function public.discover_facts_for_phg(timestamptz, int) from public, anon, authenticated;
revoke all on function public.discover_link_phg(uuid) from public, anon, authenticated;
revoke all on function public.discover_phg_products_load(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.discover_phg_profiles_load(jsonb) from public, anon, authenticated;
