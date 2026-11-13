-- Stable candidate de-duplication and normalized exact profile lookup.
-- Discover DEV only. No PHG production tables or writes.
alter table public.discover_products
  add column if not exists candidate_identity_key text;

-- Backfill only unambiguous historical candidates. If multiple historical
-- products already collide on the same identity, leave their keys NULL for
-- manual reconciliation instead of silently merging potentially distinct SKUs.
with latest_sighting as (
  select distinct on (s.discover_product_id)
    s.discover_product_id,s.read_brand,s.read_product,s.read_category,s.read_proof,s.read_size,s.read_vintage,s.label_details
  from public.bottle_sightings s
  where s.discover_product_id is not null
  order by s.discover_product_id,s.seen_at desc,s.id desc
), keyed as (
  select p.id,
    md5(concat_ws('|',
      public.discover_norm(coalesce(s.read_brand,p.brand_name,'')),
      public.discover_norm(coalesce(s.read_product,p.product_name,'')),
      public.discover_norm(coalesce(s.read_category,p.product_class,'')),
      public.discover_norm(coalesce(s.read_proof,'')),
      public.discover_norm(coalesce(s.read_size,'')),
      coalesce(s.read_vintage::text,''),
      public.discover_norm(coalesce(s.label_details ->> 'sku','')),
      public.discover_norm(coalesce(s.label_details ->> 'barcode','')),
      public.discover_norm(coalesce(s.label_details ->> 'upc_ean','')),
      public.discover_norm(coalesce(s.label_details ->> 'batch','')),
      public.discover_norm(coalesce(s.label_details ->> 'lot_code','')),
      public.discover_norm(coalesce(s.label_details ->> 'age_statement','')),
      public.discover_norm(coalesce(s.label_details ->> 'cask_finish','')),
      public.discover_norm(coalesce(s.label_details ->> 'cask_type','')),
      public.discover_norm(coalesce(s.label_details ->> 'barrel_number','')),
      public.discover_norm(coalesce(s.label_details ->> 'appellation','')),
      public.discover_norm(coalesce(s.label_details ->> 'classification',''))
    )) candidate_key
  from public.discover_products p
  join latest_sighting s on s.discover_product_id=p.id
  where p.phg_product_id is null and p.status in ('candidate','needs_review')
    and nullif(public.discover_norm(coalesce(s.read_brand,p.brand_name,'')),'') is not null
    and nullif(public.discover_norm(coalesce(s.read_product,p.product_name,'')),'') is not null
), unique_keys as (
  select candidate_key from keyed group by candidate_key having count(*)=1
)
update public.discover_products p
set candidate_identity_key=k.candidate_key
from keyed k join unique_keys u using(candidate_key)
where p.id=k.id;

create unique index if not exists discover_products_candidate_identity_key_uidx
  on public.discover_products(candidate_identity_key)
  where candidate_identity_key is not null;

create or replace function public.discover_find_exact_product(p_brand text,p_product text)
returns setof public.discover_products
language sql stable security definer set search_path to ''
as $function$
  select p.*
  from public.discover_products p
  where public.discover_norm(p.brand_name)=public.discover_norm(p_brand)
    and public.discover_norm(coalesce(p.product_name,''))=public.discover_norm(coalesce(p_product,''))
  order by p.created_at asc,p.id asc
  limit 2;
$function$;
revoke all on function public.discover_find_exact_product(text,text) from public,anon,authenticated;
grant execute on function public.discover_find_exact_product(text,text) to service_role;

-- DEV-only source migration: conservative bottle sighting attachment and bounded job claiming.
create or replace function public.discover_attach_sighting_to_product(p_sighting_id uuid)
returns table(discover_product_id uuid, match_score numeric, created_new boolean)
language plpgsql security definer set search_path to ''
as $function$
declare
  s public.bottle_sightings%rowtype;
  m public.product_index%rowtype;
  v_existing_product public.discover_products%rowtype;
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
  v_legacy_link boolean := false;
  candidate_key text;
  v_job record;
begin
  select * into s from public.bottle_sightings where id = p_sighting_id for update;
  if not found then raise exception 'Bottle sighting not found'; end if;
  if s.discover_product_id is not null then
    select * into v_existing_product from public.discover_products where id = s.discover_product_id for update;
    if not found then s.discover_product_id := null;
    elsif v_existing_product.phg_product_id is null
      and coalesce(v_existing_product.identity_payload ->> 'match_method', '') in ('local_fuzzy_index', 'brand_only_fuzzy', 'fuzzy_brand_only') then
      v_legacy_link := true;
    else
      return query select s.discover_product_id, coalesce(s.match_score, 0)::numeric, false;
      return;
    end if;
  end if;
  details := coalesce(s.label_details, '{}'::jsonb);
  fields := coalesce(details -> '_field_confidence', '{}'::jsonb);
  if coalesce(fields ->> 'brand', '') ~ '^[0-9]+([.][0-9]+)?$' then brand_conf := greatest(0, least(1, (fields ->> 'brand')::numeric)); end if;
  if coalesce(fields ->> 'product', '') ~ '^[0-9]+([.][0-9]+)?$' then product_conf := greatest(0, least(1, (fields ->> 'product')::numeric)); end if;
  has_variant :=
    nullif(btrim(coalesce(s.read_proof, '')), '') is not null or nullif(btrim(coalesce(s.read_size, '')), '') is not null or s.read_vintage is not null or
    nullif(btrim(coalesce(details ->> 'package_size', '')), '') is not null or nullif(btrim(coalesce(details ->> 'package_type', '')), '') is not null or
    nullif(btrim(coalesce(details ->> 'sku', '')), '') is not null or nullif(btrim(coalesce(details ->> 'barcode', '')), '') is not null or
    nullif(btrim(coalesce(details ->> 'upc_ean', '')), '') is not null or nullif(btrim(coalesce(details ->> 'batch', '')), '') is not null or
    nullif(btrim(coalesce(details ->> 'lot_code', '')), '') is not null or nullif(btrim(coalesce(details ->> 'age_statement', '')), '') is not null or
    nullif(btrim(coalesce(details ->> 'cask_finish', '')), '') is not null or nullif(btrim(coalesce(details ->> 'cask_type', '')), '') is not null or
    nullif(btrim(coalesce(details ->> 'barrel_number', '')), '') is not null or nullif(btrim(coalesce(details ->> 'flavor', '')), '') is not null or
    nullif(btrim(coalesce(details ->> 'style', '')), '') is not null or nullif(btrim(coalesce(details ->> 'appellation', '')), '') is not null or
    nullif(btrim(coalesce(details ->> 'appellation_level', '')), '') is not null or nullif(btrim(coalesce(details ->> 'classification', '')), '') is not null or
    nullif(btrim(coalesce(details ->> 'dosage', '')), '') is not null or nullif(btrim(coalesce(details ->> 'residual_sugar', '')), '') is not null;
  if not has_variant and brand_conf >= 0.90 and product_conf >= 0.90
    and nullif(btrim(coalesce(s.read_brand, '')), '') is not null and nullif(btrim(coalesce(s.read_product, '')), '') is not null then
    select count(*) into exact_count from public.product_index pi
    where public.discover_norm(pi.brand) = public.discover_norm(s.read_brand)
      and public.discover_norm(pi.product) = public.discover_norm(s.read_product);
    if exact_count = 1 then
      select pi.* into m from public.product_index pi
      where public.discover_norm(pi.brand) = public.discover_norm(s.read_brand)
        and public.discover_norm(pi.product) = public.discover_norm(s.read_product) limit 1;
      score := least(brand_conf, product_conf);
    end if;
  end if;
  select phg_category_id into category_id from public.phg_category_mirror
  where lower(name) = lower(coalesce(s.read_category, m.category)) order by level desc limit 1;
  if exact_count = 1 and m.id is not null then
    select id into product_id from public.discover_products where phg_product_id = m.id for update;
    identity := jsonb_build_object('sighting_id', s.id, 'identity_status', 'catalog_exact',
      'match_method', 'exact_brand_and_expression', 'matched_product_index_id', m.id,
      'matched_brand', m.brand, 'matched_product', m.product, 'field_confidence', fields, 'sku_differentiators_checked', true);
    if product_id is null and v_legacy_link then
      product_id := s.discover_product_id;
      update public.discover_products set phg_product_id=m.id, brand_name=m.brand, product_name=m.product,
        category_phg_id=category_id, product_class=coalesce(s.read_category,m.category), status='identified', candidate_identity_key=null,
        match_confidence=score, identity_payload=identity, last_seen_at=now(), updated_at=now() where id=product_id;
    elsif product_id is null then
      insert into public.discover_products(phg_product_id,brand_name,product_name,category_phg_id,product_class,match_confidence,identity_payload,status,created_from)
      values(m.id,m.brand,m.product,category_id,coalesce(s.read_category,m.category),score,identity,'identified','bottle_scan') returning id into product_id;
      created := true;
    else
      update public.discover_products set status=case when status in ('candidate','needs_review') then 'identified' else status end,
        match_confidence=greatest(coalesce(match_confidence,0),score), identity_payload=identity_payload || identity,
        last_seen_at=now(), updated_at=now() where id=product_id;
    end if;
    if v_legacy_link and product_id <> s.discover_product_id then
      update public.discover_products set status='needs_review',
        identity_payload=identity_payload || jsonb_build_object('identity_status','superseded_candidate','superseded_by_discover_product_id',product_id),
        updated_at=now() where id=s.discover_product_id;
    end if;
  else
    identity := jsonb_build_object('sighting_id',s.id,
      'identity_status',case when exact_count>1 then 'ambiguous_catalog_candidates' else 'candidate' end,
      'field_confidence',fields,'sku_differentiators_present',has_variant,'identity_policy','brand_and_expression_exact_0_90');
    -- Stable Discover candidate identity: repeated scans of the same expression
    -- and package variant converge, while distinct sizes/proofs/UPCs remain separate.
    if nullif(public.discover_norm(coalesce(s.read_brand,'')), '') is not null
      and nullif(public.discover_norm(coalesce(s.read_product,'')), '') is not null then
      candidate_key := md5(concat_ws('|',
        public.discover_norm(coalesce(s.read_brand,'')),
        public.discover_norm(coalesce(s.read_product,'')),
        public.discover_norm(coalesce(s.read_category,'')),
        public.discover_norm(coalesce(s.read_proof,'')),
        public.discover_norm(coalesce(s.read_size,'')),
        coalesce(s.read_vintage::text,''),
        public.discover_norm(coalesce(details ->> 'sku','')),
        public.discover_norm(coalesce(details ->> 'barcode','')),
        public.discover_norm(coalesce(details ->> 'upc_ean','')),
        public.discover_norm(coalesce(details ->> 'batch','')),
        public.discover_norm(coalesce(details ->> 'lot_code','')),
        public.discover_norm(coalesce(details ->> 'age_statement','')),
        public.discover_norm(coalesce(details ->> 'cask_finish','')),
        public.discover_norm(coalesce(details ->> 'cask_type','')),
        public.discover_norm(coalesce(details ->> 'barrel_number','')),
        public.discover_norm(coalesce(details ->> 'appellation','')),
        public.discover_norm(coalesce(details ->> 'classification',''))
      ));
    else
      candidate_key := null;
    end if;
    identity := identity || jsonb_build_object('candidate_identity_key',candidate_key);
    if v_legacy_link then
      product_id := s.discover_product_id;
      update public.discover_products set phg_product_id=null, brand_name=coalesce(s.read_brand,'Unknown brand'),
        product_name=s.read_product, category_phg_id=category_id, product_class=s.read_category,
        match_confidence=greatest(0,least(1,coalesce(s.read_confidence,0)))::numeric, identity_payload=identity,
        candidate_identity_key=candidate_key,
        status=case when exact_count>1 then 'needs_review' else 'candidate' end, updated_at=now() where id=product_id;
    else
      insert into public.discover_products(brand_name,product_name,category_phg_id,product_class,match_confidence,identity_payload,candidate_identity_key,status,created_from)
      values(coalesce(s.read_brand,'Unknown brand'),s.read_product,category_id,s.read_category,
        greatest(0,least(1,coalesce(s.read_confidence,0)))::numeric,identity,candidate_key,
        case when exact_count>1 then 'needs_review' else 'candidate' end,'bottle_scan')
      on conflict (candidate_identity_key) where candidate_identity_key is not null
      do update set
        last_seen_at=now(),
        updated_at=now(),
        match_confidence=greatest(coalesce(public.discover_products.match_confidence,0),excluded.match_confidence),
        identity_payload=public.discover_products.identity_payload || excluded.identity_payload
      returning id,(xmax=0) into product_id,created;
    end if;
  end if;
  update public.bottle_sightings set discover_product_id=product_id,
    product_index_id=case when exact_count=1 and m.id is not null then m.id else null end,
    match_score=case when exact_count=1 then score::real else null end where id=s.id;
  insert into public.discover_product_evidence(discover_product_id,source_type,source_name,observed_value,confidence,verification_state,metadata)
  values(product_id,'model_inference',coalesce(s.read_model,s.reader,'Discover bottle reader'),
    jsonb_build_object('brand',s.read_brand,'product',s.read_product,'category',s.read_category,'proof',s.read_proof,
      'size',s.read_size,'vintage',s.read_vintage,'label_text',s.label_text,'field_confidence',fields),
    greatest(0,least(1,coalesce(s.read_confidence,0)))::numeric,'unreviewed',
    jsonb_build_object('sighting_id',s.id,'reader_version',s.reader_version));
  for v_job in select * from (values ('identity_match'::text,10::smallint),('official_source_lookup'::text,30::smallint)) as requested(job_type,priority)
  loop
    begin
      insert into public.discover_enrichment_jobs(discover_product_id,job_type,priority,input_payload)
      values(product_id,v_job.job_type,v_job.priority,jsonb_build_object('sighting_id',s.id));
    exception when unique_violation then null;
    end;
  end loop;
  return query select product_id,score,created;
end;
$function$;
revoke all on function public.discover_attach_sighting_to_product(uuid) from public, anon, authenticated;
grant execute on function public.discover_attach_sighting_to_product(uuid) to service_role;

drop function if exists public.discover_claim_enrichment_jobs(text, integer, integer);
create or replace function public.discover_claim_enrichment_jobs(
  p_worker text,p_limit integer default 5,p_stale_after_seconds integer default 600,
  p_job_types text[] default array['identity_match']::text[])
returns setof public.discover_enrichment_jobs
language sql security definer set search_path to ''
as $function$
  with limits as (
    select greatest(1,least(coalesce(p_limit,5),10)) batch_size,
      make_interval(secs=>greatest(60,least(coalesce(p_stale_after_seconds,600),3600))) stale_after
  ),
  exhausted as (
    update public.discover_enrichment_jobs j set status='failed',locked_at=null,locked_by=null,
      last_error=coalesce(j.last_error,'stale lock expired after maximum attempts'),updated_at=now()
    from limits where j.status='processing' and j.locked_at < now()-limits.stale_after and j.attempts>=j.max_attempts returning j.id
  ),
  candidates as (
    select j.id from public.discover_enrichment_jobs j cross join limits
    where j.job_type=any(coalesce(p_job_types,array['identity_match']::text[]))
      and ((j.status in ('queued','retry') and j.available_at<=now())
        or (j.status='processing' and j.locked_at<now()-limits.stale_after and j.attempts<j.max_attempts))
    order by j.priority asc,j.available_at asc,j.created_at asc
    for update of j skip locked limit (select batch_size from limits)
  )
  update public.discover_enrichment_jobs j set status='processing',attempts=j.attempts+1,locked_at=now(),
    locked_by=left(coalesce(nullif(btrim(p_worker),''),'discover-worker'),100),last_error=null,updated_at=now()
  from candidates c where j.id=c.id returning j.*;
$function$;
revoke all on function public.discover_claim_enrichment_jobs(text,integer,integer,text[]) from public,anon,authenticated;
grant execute on function public.discover_claim_enrichment_jobs(text,integer,integer,text[]) to service_role;
create unique index if not exists discover_enrichment_jobs_one_active_per_product_type
on public.discover_enrichment_jobs(discover_product_id,job_type)
where status in ('queued','processing','retry');
