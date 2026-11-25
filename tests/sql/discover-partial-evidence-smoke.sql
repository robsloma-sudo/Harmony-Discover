-- Isolated PostgreSQL smoke test for partial evidence (17 Nov 2026): the joint brand+product part-word lookup
-- and the scan-timing metrics. Runs against the disposable postgres service in CI (after the other smoke files)
-- or a scratch local cluster. Stubs only the parts of the DEV schema the migrations touch.
do $roles$ begin
  begin create role anon nologin; exception when duplicate_object then null; end;
  begin create role authenticated nologin; exception when duplicate_object then null; end;
  begin create role service_role nologin; exception when duplicate_object then null; end;
end $roles$;

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create schema if not exists auth;
-- The signed-in person comes from a setting here (null when unset).
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('smoke.uid', true), '')::uuid $$;

-- Helpers exactly as in DEV (20261116220336 discover_letter_lookup_v2, discover_norm).
create or replace function public.discover_ocr_fix(p text) returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(p,''), '[^A-Za-z]', '', 'g')) >= 0.6 * greatest(1, length(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g')))
              then translate(coalesce(p,''), '015', 'ols') else coalesce(p,'') end
$$;
create or replace function public.discover_norm(p text) returns text language sql immutable set search_path to 'public', 'extensions' as $$
  select trim(regexp_replace(regexp_replace(lower(extensions.unaccent(coalesce(p,''))), '[''’`.]', '', 'g'), '[^a-z0-9]+', ' ', 'g'))
$$;

create table if not exists public.discover_label_catalog (
  ttb_id text primary key, brand text, product text, class_type text, origin text, permit_no text, approved date, producer text,
  phg_brand_id uuid, search_text text generated always as (lower(coalesce(brand,'') || ' ' || coalesce(product,''))) stored);
create index if not exists discover_label_catalog_trgm on public.discover_label_catalog using gin (search_text extensions.gin_trgm_ops);
create table if not exists public.discover_phg_products (phg_product_id uuid primary key default gen_random_uuid(), brand text, name text, class text, category text);
truncate public.discover_label_catalog, public.discover_phg_products;
insert into public.discover_label_catalog(ttb_id, brand, product, class_type) values
  ('1', 'Colonel E.H. Taylor', 'Cured Oak', 'straight bourbon whisky'),
  ('2', 'Colonel E.H. Taylor', 'Small Batch', 'straight bourbon whisky'),
  ('3', 'Colonel E.H. Taylor', 'Small Batch', 'straight bourbon whisky'),
  ('4', 'Taylor', 'Black', 'wine'),
  ('5', 'Duncan Taylor', 'Octave', 'single malt scotch whisky'),
  ('6', 'Duncan Taylor', 'Octave', 'single malt scotch whisky'),
  ('7', 'Maker''s Mark', '46', 'bourbon whisky'),
  ('8', 'Flue-Cured', 'Leaf', 'other');
insert into public.discover_phg_products(brand, name, class) values ('Knob Creek', '21 Year', 'other_unknown'), ('Maker''s Mark', 'Cask Strength', 'other_unknown');

create table if not exists public.discover_rate_limits (subject_id uuid, bucket text, window_start timestamptz, hits integer, primary key (subject_id, bucket));
create or replace function public.discover_rate_limit(p_subject uuid, p_bucket text, p_max integer, p_window_seconds integer) returns boolean
language sql as $$ select true $$;
create table if not exists public.discover_scan_timings (
  id bigserial primary key, consumer_id uuid, scan_session_id uuid, track_id text, named_by text not null,
  ms_to_first_box integer, ms_to_text integer, ms_to_name integer, ms_to_confirm integer, brand text, product text,
  discover_product_id uuid, label_px integer, zoom numeric, device text, app_version text, created_at timestamptz default now(),
  guess_brand text, guess_agreed boolean, ocr_ms integer, ocr_words text[],
  constraint discover_scan_timings_named_by_check check (named_by = any (array['barcode','letters','shape','ai_label','ai_frame','memory','none'])));

\i supabase/migrations/20261117200704_discover_partial_lookup.sql
\i supabase/migrations/20261117202951_discover_scan_timings_partial_evidence.sql

do $smoke$
declare r record; n int;
begin
  -- Part-words are looked up across brand AND product: TAYLO + CURED leads with Colonel E.H. Taylor / Cured Oak.
  select * into r from public.discover_partial_lookup(array['TAYLO', 'CURED'], 10) limit 1;
  if r.brand <> 'Colonel E.H. Taylor' or r.product <> 'Cured Oak' or r.anchors_matched <> 2 then
    raise exception 'joint lookup did not lead with Cured Oak: % / % (%)', r.brand, r.product, r.anchors_matched; end if;
  -- Same name on two label approvals is one candidate with labels = 2.
  if (select labels from public.discover_partial_lookup(array['batch'], 10) where product = 'Small Batch') <> 2 then
    raise exception 'duplicate label approvals not grouped'; end if;
  -- A dropped apostrophe still finds the brand, from the label approvals and the Harmony catalogue.
  select count(*) into n from public.discover_partial_lookup(array['MAKERS'], 10) where brand = 'Maker''s Mark';
  if n <> 2 then raise exception 'MAKERS did not find Maker''s Mark in both sources (%)', n; end if;
  -- Short or empty input finds nothing; wildcards in the input are plain letters.
  if exists (select 1 from public.discover_partial_lookup(array['oak', '%', '_'], 10)) then raise exception 'short or wildcard input matched'; end if;
  if exists (select 1 from public.discover_partial_lookup(null, 10)) then raise exception 'null input matched'; end if;
  -- Read-only for the scanner: signed-in users may call it, the public may not.
  if has_function_privilege('anon', 'public.discover_partial_lookup(text[],integer)', 'execute') then raise exception 'anon can call the lookup'; end if;
  if not has_function_privilege('authenticated', 'public.discover_partial_lookup(text[],integer)', 'execute') then raise exception 'scanner cannot call the lookup'; end if;

  -- Timing metrics: partial evidence fields are stored; unknown values are dropped, not stored.
  perform set_config('smoke.uid', '00000000-0000-0000-0000-0000000000a1', true);
  n := public.discover_log_scan_timings(jsonb_build_array(
    jsonb_build_object('track_id', '-3', 'named_by', 'partial', 'ms_to_name', 1800, 'ms_to_confirm', 4200, 'brand', 'Colonel E.H. Taylor',
      'guess_brand', 'Colonel E.H. Taylor', 'guess_agreed', true, 'partial', true, 'guess_source', 'partial', 'verify_calls', 1, 'verify_verdict', 'match'),
    jsonb_build_object('track_id', '-4', 'named_by', 'none', 'partial', true, 'guess_source', 'nonsense', 'verify_calls', 99, 'verify_verdict', 'maybe'),
    jsonb_build_object('track_id', '-5', 'named_by', 'made_up')));
  if n <> 2 then raise exception 'expected 2 timing rows, got %', n; end if;
  select * into r from public.discover_scan_timings where track_id = '-3';
  if r.named_by <> 'partial' or r.partial is not true or r.guess_source <> 'partial' or r.verify_calls <> 1 or r.verify_verdict <> 'match' then
    raise exception 'partial timing row wrong'; end if;
  select * into r from public.discover_scan_timings where track_id = '-4';
  if r.guess_source is not null or r.verify_calls <> 10 or r.verify_verdict is not null then raise exception 'bad values not cleaned'; end if;
  raise notice 'discover partial evidence smoke: OK';
end $smoke$;
