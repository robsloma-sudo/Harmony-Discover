-- DEV-only source migration: conservative bottle sighting attachment and bounded job claiming.
-- Do not apply to PHG/Harmony production.
create or replace function public.discover_attach_sighting_to_product(p_sighting_id uuid)
returns table(discover_product_id uuid, match_score numeric, created_new boolean)
language plpgsql security definer set search_path to ''
as $function$
declare
  s public.bottle_sightings%rowtype;
  m public.product_index%rowtype;
  product_id uuid;
  category_id uuid;
  exact_count integer := 0;
  brand_conf numeric := 0;
  product_conf numeric := 0;
  score numeric := 0;
  created boolean := false;
  details jsonb;
  fields jsonb;
  identity jsonb;
  has_variant boolean := false;
begin
  select * into s from public.bottle_sightings where id = p_sighting_id for update;
  if not found then raise exception 'Bottle sighting not found'; end if;
  if s.discover_product_id is not null then
    return query select s.discover_product_id, coalesce(s.match_score, 0)::numeric, false;
    return;
  end if;

  details := coalesce(s.label_details, '{}'::jsonb);
  fields := coalesce(details -> '_field_confidence', '{}'::jsonb);
  if coalesce(fields ->> 'brand', '') ~ '^[0-9]+([.][0-9]+)?$' then
    brand_conf := greatest(0, least(1, (fields ->> 'brand')::numeric));
  end if;
  if coalesce(fields ->> 'product', '') ~ '^[0-9]+([.][0-9]+)?$' then
    product_conf := greatest(0, least(1, (fields ->> 'product')::numeric));
  end if;

  has_variant :=
    nullif(btrim(coalesce(s.read_proof, '')), '') is not null or
    nullif(btrim(coalesce(s.read_size, '')), '') is not null or s.read_vintage is not null or
    nullif(btrim(coalesce(details ->> 'package_size', '')), '') is not null or
    nullif(btrim(coalesce(details ->> 'sku', '')), '') is not null or
    nullif(btrim(coalesce(details ->> 'barcode', '')), '') is not null or
    nullif(btrim(coalesce(details ->> 'upc_ean', '')), '') is not null or
    nullif(btrim(coalesce(details ->> 'batch', '')), '') is not null or
    nullif(btrim(coalesce(details ->> 'lot_code', '')), '') is not null;

  -- Only a unique exact brand+expression row with independent >=0.90 field reads
  -- can link to the legacy catalog. Fuzzy similarity is candidate retrieval only.
  if not has_variant and brand_conf >= 0.90 and product_conf >= 0.90
     and nullif(btrim(coalesce(s.read_brand, '')), '') is not null
     and nullif(btrim(coalesce(s.read_product, '')), '') is not null then
    select count(*) into exact_count from public.product_index pi
    where public.discover_norm(pi.brand) = public.discover_norm(s.read_brand)
      and public.discover_norm(pi.product) = public.discover_norm(s.read_product);
    if exact_count = 1 then
      select pi.* into m from public.product_index pi
      where public.discover_norm(pi.brand) = public.discover_norm(s.read_brand)
        and public.discover_norm(pi.product) = public.discover_norm(s.read_product)
      limit 1;
      score := least(brand_conf, product_conf);
    end if;
  end if;

  select phg_category_id into category_id from public.phg_category_mirror
  where lower(name) = lower(coalesce(s.read_category, m.category))
  order by level desc limit 1;

  if exact_count = 1 and m.id is not null then
    select id into product_id from public.discover_products where phg_product_id = m.id for update;
    identity := jsonb_build_object(
      'sighting_id', s.id, 'identity_status', 'catalog_exact',
      'match_method', 'exact_brand_and_expression', 'matched_product_index_id', m.id,
      'matched_brand', m.brand, 'matched_product', m.product,
      'field_confidence', fields, 'sku_differentiators_checked', true
    );
    if product_id is null then
      insert into public.discover_products(
        phg_product_id, brand_name, product_name, category_phg_id, product_class,
        match_confidence, identity_payload, status, created_from
      ) values (
        m.id, m.brand, m.product, category_id, coalesce(s.read_category, m.category),
        score, identity, 'identified', 'bottle_scan'
      ) returning id into product_id;
      created := true;
    else
      update public.discover_products
      set status = case when status in ('candidate', 'needs_review') then 'identified' else status end,
          match_confidence = greatest(coalesce(match_confidence, 0), score),
          identity_payload = identity_payload || identity, last_seen_at = now(), updated_at = now()
      where id = product_id;
    end if;
  else
    identity := jsonb_build_object(
      'sighting_id', s.id,
      'identity_status', case when exact_count > 1 then 'ambiguous_catalog_candidates' else 'candidate' end,
      'field_confidence', fields, 'sku_differentiators_present', has_variant,
      'identity_policy', 'brand_and_expression_exact_0_90'
    );
    insert into public.discover_products(
      brand_name, product_name, category_phg_id, product_class,
      match_confidence, identity_payload, status, created_from
    ) values (
      coalesce(s.read_brand, 'Unknown brand'), s.read_product, category_id, s.read_category,
      greatest(0, least(1, coalesce(s.read_confidence, 0)))::numeric,
      identity, case when exact_count > 1 then 'needs_review' else 'candidate' end, 'bottle_scan'
    ) returning id into product_id;
    created := true;
  end if;

  update public.bottle_sightings
  set discover_product_id = product_id,
      product_index_id = case when exact_count = 1 then m.id else product_index_id end,
      match_score = case when exact_count = 1 then score::real else match_score end
  where id = s.id;

  -- Preserve OCR as unreviewed evidence; it is not a verified attribute.
  insert into public.discover_product_evidence(
    discover_product_id, source_type, source_name, observed_value, confidence, verification_state, metadata
  ) values (
    product_id, 'model_inference', coalesce(s.read_model, s.reader, 'Discover bottle reader'),
    jsonb_build_object(
      'brand', s.read_brand, 'product', s.read_product, 'category', s.read_category,
      'proof', s.read_proof, 'size', s.read_size, 'vintage', s.read_vintage,
      'label_text', s.label_text, 'field_confidence', fields
    ),
    greatest(0, least(1, coalesce(s.read_confidence, 0)))::numeric,
    'unreviewed',
    jsonb_build_object('sighting_id', s.id, 'reader_version', s.reader_version)
  );

  -- A sighting may be attached repeatedly; only one active job of each type is created.
  insert into public.discover_enrichment_jobs(discover_product_id, job_type, priority, input_payload)
  select product_id, job.job_type, job.priority, jsonb_build_object('sighting_id', s.id)
  from (values ('identity_match'::text, 10::smallint), ('official_source_lookup'::text, 30::smallint)) job(job_type, priority)
  on conflict (discover_product_id, job_type)
    where status in ('queued', 'processing', 'retry') do nothing;
  return query select product_id, score, created;
end;
$function$;

revoke all on function public.discover_attach_sighting_to_product(uuid) from public, anon, authenticated;
grant execute on function public.discover_attach_sighting_to_product(uuid) to service_role;

-- Atomic queue claim with SKIP LOCKED, bounded batch size, stale-lock recovery,
-- and terminal failure when the retry budget has already been exhausted.
drop function if exists public.discover_claim_enrichment_jobs(text, integer, integer);
create or replace function public.discover_claim_enrichment_jobs(
  p_worker text, p_limit integer default 5, p_stale_after_seconds integer default 600,
  p_job_types text[] default array['identity_match']::text[]
)
returns setof public.discover_enrichment_jobs
language sql security definer set search_path to ''
as $function$
  with limits as (
    select greatest(1, least(coalesce(p_limit, 5), 10)) batch_size,
      make_interval(secs => greatest(60, least(coalesce(p_stale_after_seconds, 600), 3600))) stale_after
  ),
  exhausted as (
    update public.discover_enrichment_jobs j
    set status = 'failed', locked_at = null, locked_by = null,
      last_error = coalesce(j.last_error, 'stale lock expired after maximum attempts'), updated_at = now()
    from limits
    where j.status = 'processing' and j.locked_at < now() - limits.stale_after
      and j.attempts >= j.max_attempts
    returning j.id
  ),
  candidates as (
    select j.id from public.discover_enrichment_jobs j cross join limits
    where j.job_type = any(coalesce(p_job_types, array['identity_match']::text[]))
      and ((j.status in ('queued', 'retry') and j.available_at <= now())
        or (j.status = 'processing' and j.locked_at < now() - limits.stale_after and j.attempts < j.max_attempts))
    order by j.priority asc, j.available_at asc, j.created_at asc
    for update of j skip locked limit (select batch_size from limits)
  )
  update public.discover_enrichment_jobs j
  set status = 'processing', attempts = j.attempts + 1, locked_at = now(),
    locked_by = left(coalesce(nullif(btrim(p_worker), ''), 'discover-worker'), 100),
    last_error = null, updated_at = now()
  from candidates c where j.id = c.id returning j.*;
$function$;

revoke all on function public.discover_claim_enrichment_jobs(text, integer, integer, text[]) from public, anon, authenticated;
grant execute on function public.discover_claim_enrichment_jobs(text, integer, integer, text[]) to service_role;

-- Prevent concurrent scans from creating duplicate active work for the same product/type.
create unique index if not exists discover_enrichment_jobs_one_active_per_product_type
on public.discover_enrichment_jobs(discover_product_id, job_type)
where status in ('queued', 'processing', 'retry');
