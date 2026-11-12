-- Isolated PostgreSQL smoke test for the Phase 5 DEV migration.
-- This runs only against the disposable postgres service in GitHub Actions.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.product_index (
  id uuid primary key,
  brand text,
  product text,
  category text
);
create table public.phg_category_mirror (
  phg_category_id uuid,
  name text,
  level integer
);
create table public.discover_products (
  id uuid primary key default gen_random_uuid(),
  phg_product_id uuid unique,
  brand_name text not null,
  product_name text,
  category_phg_id uuid,
  product_class text,
  match_confidence numeric,
  identity_payload jsonb not null default '{}'::jsonb,
  status text not null default 'candidate',
  created_from text,
  last_seen_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table public.bottle_sightings (
  id uuid primary key,
  discover_product_id uuid,
  product_index_id uuid,
  match_score real,
  read_brand text,
  read_product text,
  read_category text,
  read_proof text,
  read_size text,
  read_vintage integer,
  label_details jsonb,
  read_confidence real,
  read_model text,
  reader text,
  reader_version text,
  label_text text
);
create table public.discover_product_evidence (
  id uuid primary key default gen_random_uuid(),
  discover_product_id uuid not null,
  source_type text not null,
  source_name text,
  observed_value jsonb not null,
  confidence numeric,
  verification_state text not null,
  metadata jsonb not null default '{}'::jsonb
);
create table public.discover_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  discover_product_id uuid not null,
  job_type text not null,
  priority smallint not null default 100,
  input_payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 4,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  output_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.discover_norm(p text)
returns text language sql immutable parallel safe set search_path to ''
as $$
  select btrim(regexp_replace(
    translate(lower(coalesce(p, '')), 'áàâäãåéèêëíìîïóòôöõúùûüñç’''', 'aaaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

\i supabase/migrations/20261112182500_discover_strict_sighting_attach_and_queue_claim.sql

-- The attachment and queue-claim RPCs must be service-role-only.
do $
begin
  if has_function_privilege('anon', 'public.discover_attach_sighting_to_product(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.discover_attach_sighting_to_product(uuid)', 'EXECUTE') then
    raise exception 'client roles must not execute the sighting attachment RPC';
  end if;
  if not has_function_privilege('service_role', 'public.discover_attach_sighting_to_product(uuid)', 'EXECUTE') then
    raise exception 'service_role must execute the sighting attachment RPC';
  end if;
  if has_function_privilege('anon', 'public.discover_claim_enrichment_jobs(text,integer,integer,text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.discover_claim_enrichment_jobs(text,integer,integer,text[])', 'EXECUTE') then
    raise exception 'client roles must not claim enrichment jobs';
  end if;
  if not has_function_privilege('service_role', 'public.discover_claim_enrichment_jobs(text,integer,integer,text[])', 'EXECUTE') then
    raise exception 'service_role must claim enrichment jobs';
  end if;
end $;

insert into public.product_index(id,brand,product,category)
values ('10000000-0000-0000-0000-000000000001','Example Spirits','Reposado','tequila');
insert into public.phg_category_mirror(phg_category_id,name,level)
values ('20000000-0000-0000-0000-000000000001','tequila',1);

insert into public.bottle_sightings(
  id,read_brand,read_product,read_category,read_confidence,label_details,reader,reader_version,read_model
) values (
  '30000000-0000-0000-0000-000000000001',
  'Example Spirits','Reposado','tequila',0.97,
  '{"_field_confidence":{"brand":0.97,"product":0.96}}'::jsonb,
  'discover-live-read','0.3.8','test-model'
);

do $$
declare
  attached record;
  sighting public.bottle_sightings%rowtype;
  product public.discover_products%rowtype;
  evidence_count integer;
  job_count integer;
begin
  select * into attached from public.discover_attach_sighting_to_product('30000000-0000-0000-0000-000000000001');
  select * into sighting from public.bottle_sightings where id='30000000-0000-0000-0000-000000000001';
  select * into product from public.discover_products where id=sighting.discover_product_id;
  if attached.created_new is not true then raise exception 'expected a new product record'; end if;
  if product.status <> 'identified' then raise exception 'exact unique label should be identified, got %', product.status; end if;
  if sighting.product_index_id <> '10000000-0000-0000-0000-000000000001'::uuid then raise exception 'exact catalog link missing'; end if;
  if not exists (select 1 from public.discover_product_evidence where discover_product_id=product.id and verification_state='unreviewed') then raise exception 'unreviewed OCR evidence missing'; end if;
  select count(*) into evidence_count from public.discover_product_evidence where discover_product_id=product.id;
  select count(*) into job_count from public.discover_enrichment_jobs where discover_product_id=product.id;
  if job_count <> 2 then raise exception 'expected two initial jobs, got %', job_count; end if;

  select * into attached from public.discover_attach_sighting_to_product('30000000-0000-0000-0000-000000000001');
  if attached.created_new is not false then raise exception 'repeat attach must be idempotent'; end if;
  if (select count(*) from public.discover_product_evidence where discover_product_id=product.id) <> evidence_count then raise exception 'repeat attach duplicated evidence'; end if;
  if (select count(*) from public.discover_enrichment_jobs where discover_product_id=product.id) <> job_count then raise exception 'repeat attach duplicated jobs'; end if;
end $$;

-- A second physical sighting of the same exact catalog product reuses the
-- Discover product and must not enqueue duplicate active jobs.
insert into public.bottle_sightings(
  id,read_brand,read_product,read_category,read_confidence,label_details,reader,reader_version
) values (
  '30000000-0000-0000-0000-000000000004',
  'Example Spirits','Reposado','tequila',0.98,
  '{"_field_confidence":{"brand":0.98,"product":0.98}}'::jsonb,
  'discover-live-read','0.3.8'
);
select * from public.discover_attach_sighting_to_product('30000000-0000-0000-0000-000000000004');
do $$
begin
  if (select count(*) from public.discover_products where phg_product_id='10000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'same catalog product created a duplicate Discover product';
  end if;
  if (select count(*) from public.discover_enrichment_jobs where discover_product_id=(select discover_product_id from public.bottle_sightings where id='30000000-0000-0000-0000-000000000004')) <> 2 then
    raise exception 'second physical sighting duplicated active jobs';
  end if;
end $$;

-- SKU/package differentiators must prevent a legacy catalog identity merge.
insert into public.bottle_sightings(
  id,product_index_id,match_score,read_brand,read_product,read_category,read_proof,read_confidence,label_details,reader,reader_version
) values (
  '30000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',0.99,
  'Example Spirits','Reposado','tequila','80 proof',0.99,
  '{"_field_confidence":{"brand":0.99,"product":0.99}}'::jsonb,
  'discover-live-read','0.3.8'
);
select * from public.discover_attach_sighting_to_product('30000000-0000-0000-0000-000000000002');
do $$
begin
  if (select product_index_id from public.bottle_sightings where id='30000000-0000-0000-0000-000000000002') is not null then
    raise exception 'proof differentiator must clear stale legacy catalog identity';
  end if;
  if (select match_score from public.bottle_sightings where id='30000000-0000-0000-0000-000000000002') is not null then
    raise exception 'proof differentiator must clear stale legacy match score';
  end if;
  if (select p.status from public.discover_products p join public.bottle_sightings s on s.discover_product_id=p.id where s.id='30000000-0000-0000-0000-000000000002') <> 'candidate' then
    raise exception 'SKU-differentiated product must remain a candidate';
  end if;
end $$;

-- Multiple exact catalog rows are ambiguous and must not be auto-linked.
insert into public.product_index(id,brand,product,category)
values ('10000000-0000-0000-0000-000000000002','Example Spirits','Reposado','tequila');
insert into public.bottle_sightings(
  id,read_brand,read_product,read_category,read_confidence,label_details,reader,reader_version
) values (
  '30000000-0000-0000-0000-000000000003',
  'Example Spirits','Reposado','tequila',0.99,
  '{"_field_confidence":{"brand":0.99,"product":0.99}}'::jsonb,
  'discover-live-read','0.3.8'
);
select * from public.discover_attach_sighting_to_product('30000000-0000-0000-0000-000000000003');
do $$
begin
  if (select product_index_id from public.bottle_sightings where id='30000000-0000-0000-0000-000000000003') is not null then
    raise exception 'ambiguous catalog candidates must not be auto-linked';
  end if;
  if (select p.status from public.discover_products p join public.bottle_sightings s on s.discover_product_id=p.id where s.id='30000000-0000-0000-0000-000000000003') <> 'needs_review' then
    raise exception 'ambiguous catalog candidates must be needs_review';
  end if;
end $$;

-- Worker claim is filtered, bounded, and increments attempts/lock ownership.
do $$
declare
  claimed record;
  claimed_count integer;
begin
  select * into claimed from public.discover_claim_enrichment_jobs(
    'smoke-worker', 1, 600, array['identity_match']::text[]
  );
  if claimed.id is null or claimed.job_type <> 'identity_match' or claimed.status <> 'processing' then
    raise exception 'identity job was not claimed';
  end if;
  if claimed.attempts <> 1 or claimed.locked_by <> 'smoke-worker' then
    raise exception 'claim did not set attempts and lock owner';
  end if;
  if exists (select 1 from public.discover_enrichment_jobs where job_type='official_source_lookup' and status='processing') then
    raise exception 'job-type filter claimed an official-source job';
  end if;
  select count(*) into claimed_count from public.discover_claim_enrichment_jobs(
    'smoke-worker-2', 5, 600, array['official_source_lookup']::text[]
  );
  if claimed_count <> 3 then raise exception 'expected three official-source jobs, got %', claimed_count; end if;
end $$;

-- Expired locks are reclaimable; a worker cannot claim an active lock twice.
do $$
declare
  stale_id uuid;
  reclaimed record;
begin
  update public.discover_enrichment_jobs set status='complete',locked_at=null,locked_by=null
  where job_type='identity_match' and status='queued';
  update public.discover_enrichment_jobs set locked_at=now()-interval '2 hours'
  where job_type='identity_match' and status='processing'
  returning id into stale_id;
  select * into reclaimed from public.discover_claim_enrichment_jobs(
    'recovery-worker', 1, 600, array['identity_match']::text[]
  );
  if reclaimed.id is distinct from stale_id then raise exception 'stale processing job was not reclaimed'; end if;
  if reclaimed.attempts <> 2 then raise exception 'stale retry attempt counter did not increment'; end if;
end $$;

-- Existing legacy brand-only "identified" rows must be reconciled, not returned
-- unchanged by the new idempotency guard.
insert into public.product_index(id,brand,product,category)
values ('10000000-0000-0000-0000-000000000003','Michter''s',null,null);
insert into public.discover_products(
  id,brand_name,product_name,identity_payload,status,created_from
) values (
  '40000000-0000-0000-0000-000000000001',
  'Michter''s',null,
  '{"match_method":"local_fuzzy_index","matched_brand":"Michter''s","matched_product":null,"matched_category":null}'::jsonb,
  'identified','bottle_scan'
);
insert into public.bottle_sightings(
  id,discover_product_id,product_index_id,match_score,
  read_brand,read_product,read_category,read_confidence,label_details,reader,reader_version
) values (
  '30000000-0000-0000-0000-000000000005',
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000003',0.92,
  'Michter''s','Barrel Strength','American whiskey',0.96,
  '{"classification":"Limited Release","_field_confidence":{}}'::jsonb,
  'discover-live-read','0.3.8'
);
select * from public.discover_attach_sighting_to_product('30000000-0000-0000-0000-000000000005');
do $$
declare
  linked_product public.discover_products%rowtype;
  linked_sighting public.bottle_sightings%rowtype;
begin
  select * into linked_sighting from public.bottle_sightings
  where id='30000000-0000-0000-0000-000000000005';
  select * into linked_product from public.discover_products
  where id=linked_sighting.discover_product_id;
  if linked_sighting.discover_product_id <> '40000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'legacy fuzzy product record should be reconciled in place';
  end if;
  if linked_product.status <> 'candidate' then
    raise exception 'brand-only legacy identified row must be downgraded to candidate';
  end if;
  if linked_product.phg_product_id is not null or linked_sighting.product_index_id is not null or linked_sighting.match_score is not null then
    raise exception 'legacy brand-only catalog association was not cleared';
  end if;
  if linked_product.identity_payload ->> 'identity_status' <> 'candidate' then
    raise exception 'legacy identity payload was not rewritten to candidate';
  end if;
end $$;
