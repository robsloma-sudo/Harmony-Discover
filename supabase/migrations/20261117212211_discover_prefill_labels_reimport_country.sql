-- Labels: an importer's approval of an American whiskey (class "usb", or Kentucky/Tennessee/bourbon in the
-- name) no longer sets the bottle's country to the country it was shipped from.
CREATE OR REPLACE FUNCTION public.discover_prefill_from_labels(p_product uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_facts int := 0; v_pk int := 0;
begin
  -- Only label-catalogue matches (a confident name match); "specific" = the label names this exact expression
  -- (not just the brand) and the numbers in both names agree, so its detail (ABV, age, barcode) belongs to this bottle.
  drop table if exists pg_temp._lp; create temp table _lp on commit drop as
  select d.id, d.product_name, d.cola_ttb_id ttb, c.similarity sc, c.class_type, c.origin, c.permit_no, c.producer,
         (c.similarity >= 0.9 and public.discover_norm(coalesce(c.product,'')) <> public.discover_norm(c.brand)
          and public.discover_norm(coalesce(c.product,'')) <> ''
          and public.discover_nums(d.product_name) = public.discover_nums(c.product)
          -- a home-made bottle approved on an importer's permit (or the reverse) is someone else's label
          and c.permit_no is not null
          and ((public.discover_us_state(c.origin) or c.origin = 'american') = (c.permit_no !~ '-I-'))) specific,
         x.abv, x.aged_years, x.grains, x.finishing, x.vintage, x.appellation, x.varietals, x.volume, x.volume_unit, x.barcodes, x.status detail_status,
         public.discover_us_state(c.origin) or c.origin = 'american' us_origin,
         -- wine-only facts (vintage, appellation, grapes) are copied only from wine labels
         coalesce(public.discover_label_family(c.class_type) = 'wine', false) is_wine,
         'https://ttbonline.gov/colasonline/viewColaDetails.do?action=publicDisplaySearchBasic&ttbid=' || d.cola_ttb_id url
    from public.discover_products d
    join public.discover_product_label_facts c on c.discover_product_id = d.id and c.source = 'label_catalogue'
    left join public.discover_cola_details x on x.ttb_id = d.cola_ttb_id and x.status = 'done'
   where d.cola_ttb_id is not null and (p_product is null or d.id = p_product);

  drop table if exists pg_temp._lf; create temp table _lf on commit drop as
  with f as (
    select id, 'country' code, case when us_origin then 'United States' else initcap(origin) end val, sc conf, ttb, url, product_name from _lp
     where nullif(origin,'') is not null and origin !~* 'multiple|mutiple|west indies|european union'
       -- An importer's approval of an American whiskey names the country it was shipped from, not where it
       -- was made (George T. Stagg re-imported via New Zealand). Such a label never sets the country.
       and not (coalesce(permit_no, '') ~ '-I-' and not us_origin
                and (class_type ~* '\musb\M|bourbon|tennessee|american' or coalesce(product_name, '') ~* 'kentucky|tennessee|bourbon'))
    union all select id, 'state_or_province', initcap(origin), sc, ttb, url, product_name from _lp where public.discover_us_state(origin)
    union all select id, case when us_origin then 'bottler' else 'importer' end, public.discover_company_case(producer), sc, ttb, url, product_name
      from _lp where producer is not null and permit_no is not null and (us_origin = (permit_no !~ '-I-'))
    union all select id, 'classification', public.discover_class_label(class_type), sc, ttb, url, product_name from _lp
    union all select id, 'alcohol_statement', public.discover_num_txt(abv) || '% ABV', sc, ttb, url, product_name from _lp where specific and abv between 0.1 and 96 and coalesce(product_name, '') !~* '(barrel proof|cask strength|barrel strength|full proof|batch proof|uncut|unfiltered proof)'
    union all select id, 'age_statement', 'Aged ' || aged_years || ' years', sc, ttb, url, product_name from _lp
      where specific and aged_years between 1 and 80 and aged_years::text = any(public.discover_nums(product_name))
    union all select id, 'grain', array_to_string(grains, ', '), sc, ttb, url, product_name from _lp where false
    union all select id, 'cask_finish', finishing, sc, ttb, url, product_name from _lp where false
    union all select id, 'vintage', vintage::text, sc, ttb, url, product_name from _lp where specific and is_wine and vintage between 1900 and 2100
    union all select id, 'appellation', appellation, sc, ttb, url, product_name from _lp where specific and is_wine and nullif(appellation,'') is not null
    union all select id, 'grapes', array_to_string(varietals, ', '), sc, ttb, url, product_name from _lp where specific and is_wine and cardinality(varietals) > 0)
  select distinct on (id, code) * from f where nullif(val,'') is not null;

  delete from _lf where exists (select 1 from public.discover_product_attributes a where a.discover_product_id = _lf.id and a.attribute_code = _lf.code);

  with ev as (
    insert into public.discover_product_evidence(discover_product_id, attribute_code, source_type, source_name, source_url, observed_value, confidence, verification_state, metadata)
    select id, code, 'ttb_cola', 'US label approval (TTB COLA)', url, jsonb_build_object('value', val, 'attribute_code', code, 'product_expression', product_name),
           least(0.9, greatest(0.5, coalesce(conf, 0.8) * 0.9)), 'unreviewed', jsonb_build_object('source', 'harmony_labels', 'ttb_id', ttb, 'supports', jsonb_build_array(code))
      from _lf
    returning id ev_id, discover_product_id, attribute_code, confidence)
  insert into public.discover_product_attributes(discover_product_id, attribute_code, value_text, state, confidence, evidence_id)
  select f.id, f.code, f.val, 'found', ev.confidence, ev.ev_id from _lf f join ev on ev.discover_product_id = f.id and ev.attribute_code = f.code
  on conflict (discover_product_id, attribute_code) do nothing;
  get diagnostics v_facts = row_count;

  -- The approved label's package (size, ABV, barcode) is kept as a package of this product.
  insert into public.discover_product_packages(discover_product_id, package_size_ml, abv_percent, upc_gtin, label_approval_id, package_payload)
  select id, public.discover_ml(volume, volume_unit), abv, case when cardinality(barcodes) = 1 then barcodes[1] end, ttb,
         jsonb_build_object('source', 'harmony_labels', 'barcodes', to_jsonb(barcodes))
    from _lp where specific and detail_status = 'done'
  on conflict (discover_product_id, label_approval_id) where label_approval_id is not null do nothing;
  get diagnostics v_pk = row_count;
  return jsonb_build_object('facts_added', v_facts, 'packages_added', v_pk);
end $function$;
