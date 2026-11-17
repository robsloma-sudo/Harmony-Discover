-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116202628 "discover_prefill_from_phg_v2" was applied live but was never committed to the repo.

create or replace function public.discover_us_state(p text) returns boolean language sql immutable as $$
  select lower(trim(coalesce(p,''))) = any (array['alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','district of columbia','florida','georgia','hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey','new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island','south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia','wisconsin','wyoming'])
$$;

create or replace function public.discover_prefill_from_phg(p_product uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_facts int := 0; v_cat_linked int := 0; v_cat_kind int := 0; v_kind_fixed int := 0; v_conflicts int := 0;
begin
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
    select d.id, p.*,
           (coalesce(p.country,'') ~* '^(united states|usa|us)$' or (nullif(p.country,'') is null and public.discover_us_state(p.origin))) domestic,
           case when ttb_id ~ '^\d{8,}$' then 'https://ttbonline.gov/colasonline/viewColaDetails.do?action=publicDisplaySearchBasic&ttbid=' || ttb_id end ttb_url
    from public.discover_products d join public.discover_phg_products p on p.phg_product_id = d.phg_product_id
    where d.phg_link_method in ('auto_barcode','auto_name','manual') and (p_product is null or d.id = p_product)),
  f as (
    select id, 'alcohol_statement' code,
           discover_num_txt(abv) || '% ABV' || case when category_path like 'spirits%' then ' (' || discover_num_txt(abv * 2) || ' proof)' else '' end val,
           'other' st, 'Harmony catalogue' sn, null::text su, 0.9 conf, 'corroborated' vs, phg_code from lp where abv between 0.1 and 96
    union all
    select id, 'size', case when size_ml >= 1000 then discover_num_txt(round(size_ml / 1000.0, 3)) || ' L' else discover_num_txt(size_ml) || ' ml' end,
           'other', 'Harmony catalogue', null, 0.9, 'corroborated', phg_code from lp where size_ml between 10 and 30000
    union all
    select id, case when domestic then 'bottler' else 'importer' end,
           initcap(producer) || coalesce(', ' || initcap(nullif(producer_city,'')), '') || coalesce(', ' || upper(nullif(producer_state,'')), ''),
           'ttb_cola', 'US label approval (TTB COLA)', ttb_url, case label_tier when 'strong' then 0.9 else 0.75 end, 'corroborated', phg_code
      from lp where producer is not null and label_tier in ('strong','likely')
    union all
    select id, 'country', coalesce(nullif(country,''), case when public.discover_us_state(origin) and label_tier in ('strong','likely') then 'United States' end),
           'other', 'Harmony catalogue', null, 0.9, 'corroborated', phg_code from lp
    union all
    select id, 'state_or_province', initcap(origin), 'ttb_cola', 'US label approval (TTB COLA)', ttb_url,
           case label_tier when 'strong' then 0.9 else 0.75 end, 'corroborated', phg_code
      from lp where public.discover_us_state(origin) and label_tier in ('strong','likely')
    union all
    select id, 'subcategory', category, 'other', 'Harmony category tree', null, 0.85, 'corroborated', phg_code from lp where nullif(category,'') is not null
  )
  select * from f where nullif(val,'') is not null;

  insert into _f
  select d.id, 'history', left(array_to_string(array(select jsonb_array_elements_text(bp.history) limit 3), ' '), 1200),
         'other', 'Harmony brand profile (approved v' || bp.version || ')', null, 0.9, 'verified', null
    from public.discover_products d join public.discover_phg_brand_profiles bp on bp.phg_brand_id = d.phg_brand_id
   where d.phg_link_method in ('auto_barcode','auto_name','manual','auto_brand') and jsonb_typeof(bp.history) = 'array' and jsonb_array_length(bp.history) > 0
     and (p_product is null or d.id = p_product);

  delete from _f where exists (select 1 from public.discover_product_attributes a where a.discover_product_id = _f.id and a.attribute_code = _f.code);

  with ev as (
    insert into public.discover_product_evidence(discover_product_id, attribute_code, source_type, source_name, source_url, observed_value, confidence, verification_state, metadata)
    select _f.id, code, st, sn, su, jsonb_build_object('value', val, 'attribute_code', code, 'product_expression', dp.product_name), conf, vs,
           jsonb_build_object('source', 'harmony', 'phg_code', phg_code, 'supports', jsonb_build_array(code))
      from _f join public.discover_products dp on dp.id = _f.id
    returning id ev_id, discover_product_id, attribute_code)
  insert into public.discover_product_attributes(discover_product_id, attribute_code, value_text, state, confidence, evidence_id)
  select f.id, f.code, f.val, 'found', f.conf, ev.ev_id from _f f join ev on ev.discover_product_id = f.id and ev.attribute_code = f.code
  on conflict (discover_product_id, attribute_code) do nothing;
  get diagnostics v_facts = row_count;

  return jsonb_build_object('facts_added', v_facts, 'category_from_harmony', v_cat_linked, 'kind_fixed', v_kind_fixed,
                            'category_from_kind', v_cat_kind, 'kind_conflicts', v_conflicts);
end $$;
revoke all on function public.discover_prefill_from_phg(uuid) from public, anon, authenticated;
