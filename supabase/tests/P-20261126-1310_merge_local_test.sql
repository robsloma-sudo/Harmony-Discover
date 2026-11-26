-- P-20261126-1310 part 1: local test on an empty throwaway Postgres (never on a real database).
-- psql -v ON_ERROR_STOP=1 -d <empty db> -f supabase/tests/P-20261126-1310_merge_local_test.sql   (run from the repo root)
-- Builds a cut-down copy of the merge tables, shows the OLD commands crash on a shared label package, then loads the
-- NEW commands and checks: clash combined, nothing lost, Harmony link carried, one bad pair logged and skipped.
create role anon; create role authenticated;
create extension if not exists pgcrypto;
create table discover_brand_lines(id uuid primary key default gen_random_uuid(), release_pattern text);
create table discover_products(id uuid primary key default gen_random_uuid(), status text, discover_line_id uuid, brand_name text, product_name text,
 identity_payload jsonb default '{}', created_at timestamptz default clock_timestamp(), first_seen_at timestamptz default now(), last_seen_at timestamptz default now(),
 upc_gtin text, ean text, phg_product_id uuid unique, candidate_identity_key text, updated_at timestamptz default now());
create unique index discover_products_candidate_identity_key_uidx on discover_products(candidate_identity_key) where candidate_identity_key is not null;
create table discover_product_merges(id bigserial primary key, merged_at timestamptz default now(), from_product_id uuid, into_product_id uuid, reason text, snapshot jsonb);
create table discover_product_evidence(id uuid primary key default gen_random_uuid(), discover_product_id uuid references discover_products on delete cascade);
create table discover_product_attributes(id uuid primary key default gen_random_uuid(), discover_product_id uuid references discover_products on delete cascade, attribute_code text,
 value_text text, value_numeric numeric, value_json jsonb, unit text, state text, confidence numeric, evidence_id uuid, updated_at timestamptz, unique(discover_product_id, attribute_code));
create table discover_product_packages(id uuid primary key default gen_random_uuid(), discover_product_id uuid not null references discover_products on delete cascade, phg_package_id uuid unique,
 package_size_ml numeric, abv_percent numeric, package_type text, container_material text, upc_gtin text, ean text, label_approval_id text, package_payload jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index discover_product_packages_label_uidx on discover_product_packages(discover_product_id, label_approval_id) where label_approval_id is not null;
create table bottle_sightings(id uuid primary key default gen_random_uuid(), discover_product_id uuid references discover_products on delete set null);
create table discover_phg_export_queue(id uuid primary key default gen_random_uuid(), discover_product_id uuid references discover_products on delete restrict);
create table discover_enrichment_jobs(id uuid primary key default gen_random_uuid(), discover_product_id uuid references discover_products on delete cascade, job_type text, status text);
create unique index discover_enrichment_jobs_one_active_per_product_type on discover_enrichment_jobs(discover_product_id, job_type) where status in ('queued','processing','retry');
create table discover_product_search_usage(discover_product_id uuid primary key references discover_products on delete cascade, searches int, research_runs int, last_research_at timestamptz);
create table discover_research_outcomes(id uuid primary key default gen_random_uuid(), discover_product_id uuid);
create table discover_product_label_facts(discover_product_id uuid primary key references discover_products on delete cascade, ttb_id text, similarity numeric);
create table discover_shape_observations(id bigserial primary key, discover_product_id uuid references discover_products on delete cascade);
create table discover_shape_profiles(discover_product_id uuid references discover_products on delete cascade, size_ml numeric, container text, distance_band text, observations int,
 aspect numeric, aspect_sd numeric, shoulder_at numeric, neck_width numeric, base_width numeric, outline jsonb, colour jsonb, updated_at timestamptz, primary key(discover_product_id,size_ml,container,distance_band));
create table discover_cola_detail_wanted(ttb_id text primary key, discover_product_id uuid);
create table discover_scan_timings(id bigserial primary key, discover_product_id uuid);
create function discover_norm(t text) returns text language sql immutable as $$ select lower(btrim(coalesce(t,''))) $$;
create function discover_product_core_key(t text) returns text language sql immutable as $$ select coalesce(string_agg(distinct w,' ' order by w),'') from unnest(string_to_array(lower(coalesce(t,'')),' ')) w where w<>'' $$;
\i supabase/rollback/20261126140000_discover_merge_package_clash_ROLLBACK.sql
-- pair A: same name, both have package with label L1 (the live crash). keep = more attributes.
insert into discover_products(id,status,brand_name,product_name,phg_product_id) values
 ('a0000000-0000-0000-0000-00000000000a','candidate','JD','Single Barrel',null),
 ('a0000000-0000-0000-0000-00000000000b','candidate','JD','Barrel Single','11111111-1111-1111-1111-111111111111');
insert into discover_product_attributes(discover_product_id,attribute_code,value_text,confidence) values ('a0000000-0000-0000-0000-00000000000a','abv','45',0.9);
insert into discover_product_packages(discover_product_id,label_approval_id,package_size_ml,package_payload,upc_gtin) values
 ('a0000000-0000-0000-0000-00000000000a','L1',750,'{"k":1}',null),
 ('a0000000-0000-0000-0000-00000000000b','L1',null,'{"k":2,"extra":true}','0123'),
 ('a0000000-0000-0000-0000-00000000000b','L2',700,'{}',null);
insert into discover_product_label_facts values ('a0000000-0000-0000-0000-00000000000a','T1',0.8),('a0000000-0000-0000-0000-00000000000b','T2',0.9);
insert into discover_cola_detail_wanted values ('T2','a0000000-0000-0000-0000-00000000000b');
insert into discover_shape_profiles(discover_product_id,size_ml,container,distance_band,observations,aspect) values
 ('a0000000-0000-0000-0000-00000000000a',750,'glass','near',3,1.1),('a0000000-0000-0000-0000-00000000000b',750,'glass','near',2,1.3);
insert into discover_shape_observations(discover_product_id) values ('a0000000-0000-0000-0000-00000000000b');
insert into discover_scan_timings(discover_product_id) values ('a0000000-0000-0000-0000-00000000000b');
insert into discover_enrichment_jobs(discover_product_id,job_type,status) values ('a0000000-0000-0000-0000-00000000000a','research','queued'),('a0000000-0000-0000-0000-00000000000b','research','queued');
-- pair B: same name, no clash
insert into discover_products(id,status,brand_name,product_name) values
 ('b0000000-0000-0000-0000-00000000000a','candidate','Michters','Toasted Barrel'),('b0000000-0000-0000-0000-00000000000b','candidate','Michters','Barrel Toasted');
insert into discover_product_attributes(discover_product_id,attribute_code) values ('b0000000-0000-0000-0000-00000000000a','x');
insert into discover_product_packages(discover_product_id,label_approval_id) values ('b0000000-0000-0000-0000-00000000000b','L9');
-- pair C: same name, will be made to fail on purpose
insert into discover_products(id,status,brand_name,product_name) values
 ('c0000000-0000-0000-0000-00000000000a','candidate','VW','Rye Family'),('c0000000-0000-0000-0000-00000000000b','candidate','VW','Family Rye');
insert into discover_product_attributes(discover_product_id,attribute_code) values ('c0000000-0000-0000-0000-00000000000a','x');
insert into discover_product_packages(discover_product_id,label_approval_id) values ('c0000000-0000-0000-0000-00000000000b','L5');
\set ON_ERROR_STOP 0
select discover_merge_duplicates();  -- OLD: expected ERROR duplicate key ... discover_product_packages_label_uidx
\set ON_ERROR_STOP 1
\i supabase/migrations/20261126140000_discover_merge_package_clash.sql
create function _blk() returns trigger language plpgsql as $$ begin if old.id='c0000000-0000-0000-0000-00000000000b' then raise exception 'deliberate test failure'; end if; return old; end $$;
create trigger _blk before delete on discover_products for each row execute function _blk();
do $t$ declare n int; begin
  n := discover_merge_duplicates();
  assert n = 2, 'expected 2 merged, got '||n;
  assert (select count(*) from discover_merge_skips where from_product_id='c0000000-0000-0000-0000-00000000000b' and last_error='deliberate test failure') = 1, 'bad pair not logged';
  assert exists (select 1 from discover_product_packages where discover_product_id='c0000000-0000-0000-0000-00000000000b'), 'bad pair half-merged';
  assert (select count(*) from discover_product_packages where discover_product_id='a0000000-0000-0000-0000-00000000000a') = 2, 'L1 combined + L2 moved expected';
  assert (select upc_gtin='0123' and package_size_ml=750 and package_payload='{"k":1,"extra":true}' from discover_product_packages where discover_product_id='a0000000-0000-0000-0000-00000000000a' and label_approval_id='L1'), 'combine did not fill empty fields';
  assert (select phg_product_id='11111111-1111-1111-1111-111111111111' from discover_products where id='a0000000-0000-0000-0000-00000000000a'), 'Harmony link lost';
  assert (select discover_product_id='a0000000-0000-0000-0000-00000000000a' from discover_cola_detail_wanted where ttb_id='T2'), 'label-detail request left dangling';
  assert (select observations=5 from discover_shape_profiles where discover_product_id='a0000000-0000-0000-0000-00000000000a'), 'shape counts not added';
  assert (select snapshot->'label_facts'->0->>'ttb_id'='T2' and jsonb_array_length(snapshot->'packages')=2 from discover_product_merges where from_product_id='a0000000-0000-0000-0000-00000000000b'), 'snapshot incomplete';
  n := discover_merge_duplicates();
  assert (select tries from discover_merge_skips where from_product_id='c0000000-0000-0000-0000-00000000000b') = 2, 'tries not counted';
  drop trigger _blk on discover_products;
  n := discover_merge_duplicates();
  assert n = 1 and not exists (select 1 from discover_merge_skips), 'fixed pair should merge and clear its skip row';
  raise notice 'ALL CHECKS PASSED';
end $t$;
