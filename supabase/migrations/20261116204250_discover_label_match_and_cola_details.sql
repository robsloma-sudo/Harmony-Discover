-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116204250 "discover_label_match_and_cola_details" was applied live but was never committed to the repo.

alter table public.discover_products add column if not exists cola_ttb_id text;
alter table public.discover_products add column if not exists cola_match_score numeric;
alter table public.discover_products add column if not exists cola_matched_at timestamptz;

create table if not exists public.discover_cola_details (
  ttb_id text primary key, status text, done_at timestamptz,
  abv numeric, volume numeric, volume_unit text, product_type text, class text, origin text, permit text, domestic_or_imported text,
  barcodes text[], aged_years integer, grains text[], finishing text, category text, vintage integer, appellation text, varietals text[],
  synced_at timestamptz not null default now()
);
create table if not exists public.discover_cola_detail_wanted (
  ttb_id text primary key, discover_product_id uuid, wanted_at timestamptz not null default now(), sent_at timestamptz, reply jsonb
);
alter table public.discover_cola_details enable row level security;
alter table public.discover_cola_detail_wanted enable row level security;

-- Which US label approval is this bottle? Harmony's own label link first (linked products), else the label catalogue.
create or replace function public.discover_label_match(p_product uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare d record; v_ttb text; v_score numeric; v_text text; top record;
begin
  select id, brand_name, product_name, phg_match_product_id, cola_ttb_id into d from public.discover_products where id = p_product;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_product'); end if;
  select p.ttb_id into v_ttb from public.discover_phg_products p where p.phg_product_id = d.phg_match_product_id and p.ttb_id ~ '^\d{8,}$';
  if v_ttb is not null then v_score := 1;
  else
    v_text := trim(coalesce(d.brand_name, '') || ' ' || coalesce(d.product_name, ''));
    if length(v_text) < 4 then return jsonb_build_object('ok', false, 'reason', 'too_short'); end if;
    select * into top from (
      select l.*, row_number() over (order by l.similarity desc, (l.producer is not null) desc, l.labels desc) rn
        from public.discover_label_lookup(v_text, 5) l
       where l.similarity >= (select max(similarity) from public.discover_label_lookup(v_text, 5)) - 0.02) z
     where rn = 1;
    if top.latest_ttb_id is null or top.similarity < 0.8
       or not (regexp_replace(public.discover_norm(top.brand), '^the ', '') = regexp_replace(public.discover_norm(d.brand_name), '^the ', '')
               or similarity(public.discover_norm(top.brand), public.discover_norm(d.brand_name)) >= 0.8) then
      return jsonb_build_object('ok', false, 'reason', 'no_confident_label', 'best', top.brand || ' / ' || top.product, 'similarity', top.similarity);
    end if;
    v_ttb := top.latest_ttb_id; v_score := round(top.similarity::numeric, 2);
  end if;
  update public.discover_products set cola_ttb_id = v_ttb, cola_match_score = v_score, cola_matched_at = now()
   where id = p_product and cola_ttb_id is distinct from v_ttb;
  insert into public.discover_cola_detail_wanted(ttb_id, discover_product_id)
  select v_ttb, p_product where not exists (select 1 from public.discover_cola_details c where c.ttb_id = v_ttb)
  on conflict (ttb_id) do nothing;
  return jsonb_build_object('ok', true, 'ttb_id', v_ttb, 'score', v_score);
end $$;

create or replace function public.discover_class_label(p text) returns text language sql immutable as $$
  select case when c is null or c ~* '(other|specialt|proprietar|cocktail|diluted|^whisky$|^vodka$|^gin$|^rum$|^brandy$|^tequila$)' then null
              else initcap(c) end
  from (select nullif(trim(regexp_replace(regexp_replace(lower(coalesce(p,'')), '\s+(fb|usb|us)$', ''), '\s*\(cont\.\)', '')), '') c) x
$$;

-- Copy label facts (US label approval + label detail) into empty card fields. Never overwrites.
create or replace function public.discover_prefill_from_labels(p_product uuid default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_facts int := 0; v_upc int := 0;
begin
  create temp table _lf on commit drop as
  with lp as (
    select d.id, d.product_name, d.cola_ttb_id ttb, d.cola_match_score sc, c.class_type, c.origin, c.permit_no, c.producer,
           x.abv, x.aged_years, x.grains, x.finishing, x.vintage, x.appellation, x.varietals,
           public.discover_us_state(c.origin) or c.origin = 'american' us_origin,
           'https://ttbonline.gov/colasonline/viewColaDetails.do?action=publicDisplaySearchBasic&ttbid=' || d.cola_ttb_id url
      from public.discover_products d
      left join public.discover_label_catalog c on c.ttb_id = d.cola_ttb_id
      left join public.discover_cola_details x on x.ttb_id = d.cola_ttb_id and x.status = 'done'
     where d.cola_ttb_id is not null and (p_product is null or d.id = p_product)),
  f as (
    select id, 'country' code, case when us_origin then 'United States' else initcap(origin) end val, sc conf, ttb, url, product_name from lp where nullif(origin,'') is not null and origin !~* 'multiple|mutiple|west indies|european union'
    union all select id, 'state_or_province', initcap(origin), sc, ttb, url, product_name from lp where public.discover_us_state(origin)
    union all select id, case when us_origin then 'bottler' else 'importer' end, public.discover_company_case(producer), sc, ttb, url, product_name
      from lp where producer is not null and permit_no is not null and (us_origin = (permit_no !~ '-I-'))
    union all select id, 'classification', public.discover_class_label(class_type), sc, ttb, url, product_name from lp
    union all select id, 'alcohol_statement', public.discover_num_txt(abv) || '% ABV', sc, ttb, url, product_name from lp where abv between 0.1 and 96
    union all select id, 'age_statement', 'Aged ' || aged_years || ' years', sc, ttb, url, product_name from lp where aged_years between 1 and 80
    union all select id, 'grain', array_to_string(grains, ', '), sc, ttb, url, product_name from lp where cardinality(grains) > 0
    union all select id, 'cask_finish', finishing, sc, ttb, url, product_name from lp where nullif(finishing,'') is not null
    union all select id, 'vintage', vintage::text, sc, ttb, url, product_name from lp where vintage between 1900 and 2100
    union all select id, 'appellation', appellation, sc, ttb, url, product_name from lp where nullif(appellation,'') is not null
    union all select id, 'grapes', array_to_string(varietals, ', '), sc, ttb, url, product_name from lp where cardinality(varietals) > 0)
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

  -- One barcode on the label detail and none on the product: keep it (it links future scans by barcode).
  update public.discover_products d set upc_gtin = x.barcodes[1], updated_at = now()
    from public.discover_cola_details x
   where x.ttb_id = d.cola_ttb_id and d.upc_gtin is null and cardinality(x.barcodes) = 1 and x.barcodes[1] ~ '^\d{8,14}$'
     and not exists (select 1 from public.discover_products o where o.upc_gtin = x.barcodes[1] and o.id <> d.id)
     and (p_product is null or d.id = p_product);
  get diagnostics v_upc = row_count;
  return jsonb_build_object('facts_added', v_facts, 'barcodes_added', v_upc);
end $$;

create or replace function public.discover_cola_details_load(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.discover_cola_details(ttb_id, status, done_at, abv, volume, volume_unit, product_type, class, origin, permit, domestic_or_imported,
     barcodes, aged_years, grains, finishing, category, vintage, appellation, varietals, synced_at)
  select r->>'ttb_id', r->>'status', (r->>'done_at')::timestamptz, nullif(r->>'abv','')::numeric, nullif(r->>'volume','')::numeric, r->>'volume_unit',
     r->>'product_type', r->>'class', r->>'origin', r->>'permit', r->>'domestic_or_imported',
     case when jsonb_typeof(r->'barcodes') = 'array' then array(select jsonb_array_elements_text(r->'barcodes')) end,
     nullif(r->>'aged_years','')::int,
     case when jsonb_typeof(r->'grains') = 'array' then array(select jsonb_array_elements_text(r->'grains')) end,
     r->>'finishing', r->>'category', nullif(r->>'vintage','')::int, r->>'appellation',
     case when jsonb_typeof(r->'varietals') = 'array' then array(select jsonb_array_elements_text(r->'varietals')) end, now()
  from jsonb_array_elements(p_rows) r where r->>'ttb_id' is not null
  on conflict (ttb_id) do update set status = excluded.status, done_at = excluded.done_at, abv = excluded.abv, volume = excluded.volume,
     volume_unit = excluded.volume_unit, product_type = excluded.product_type, class = excluded.class, origin = excluded.origin, permit = excluded.permit,
     domestic_or_imported = excluded.domestic_or_imported, barcodes = excluded.barcodes, aged_years = excluded.aged_years, grains = excluded.grains,
     finishing = excluded.finishing, category = excluded.category, vintage = excluded.vintage, appellation = excluded.appellation,
     varietals = excluded.varietals, synced_at = now();
  get diagnostics n = row_count; return n;
end $$;

revoke all on function public.discover_label_match(uuid) from public, anon, authenticated;
revoke all on function public.discover_prefill_from_labels(uuid) from public, anon, authenticated;
revoke all on function public.discover_cola_details_load(jsonb) from public, anon, authenticated;
