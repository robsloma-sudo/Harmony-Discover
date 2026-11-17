-- Harmony Discover DEV: label word roles, brand lines, barcodes and releases.
--
-- A label carries many kinds of words. Only four parts name the exact bottle:
--     brand + line + release + size
-- Category words ("Kentucky Straight Bourbon Whiskey"), strength / expression words
-- ("Bottled in Bond", "Barrel Proof"), producer, place, deposit and warning text
-- describe the bottle but never become its name. The barcode names brand + line + size;
-- proof plus the laser lot code on the glass pick the release.
--
-- PHG production stays canonical. phg_category_term_mirror is a read-only copy of PHG
-- category_terms; PHG attribute codes are only referenced, never redefined. Nothing here
-- writes to PHG. Backend-only: tables have RLS on and no client grants; functions are
-- service_role only.

-- 1) Read-only copy of PHG category_terms --------------------------------------------
create table if not exists public.phg_category_term_mirror (
  phg_category_term_id uuid primary key,
  phg_category_id uuid not null,
  term text not null,
  term_norm text generated always as (public.discover_norm(term)) stored,
  match_type text not null,
  term_kind text not null,
  priority integer not null default 50,
  language text,
  origin text,
  active boolean not null default true,
  legal_status_note text,
  synced_at timestamptz not null default now()
);
create index if not exists phg_category_term_mirror_norm_idx on public.phg_category_term_mirror(term_norm);

-- 2) Label word dictionary: phrase -> role (+ PHG code it maps to) --------------------
create table if not exists public.discover_label_terms (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  term_norm text generated always as (public.discover_norm(term)) stored,
  role text not null check (role in ('category', 'attribute', 'modifier', 'brand_hint', 'exclusion',
    'producer_phrase', 'place', 'regulatory', 'descriptor')),
  maps_to jsonb not null default '{}'::jsonb,
  source text not null check (source in ('phg_category_terms', 'discover_seed')),
  source_ref text not null default '',
  priority integer not null default 50,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  unique (source, source_ref, term_norm, role)
);
create index if not exists discover_label_terms_norm_idx on public.discover_label_terms(term_norm) where active;

-- 3) Brand lines (the "line" part of the identity) -----------------------------------
create table if not exists public.discover_brand_lines (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  brand_aliases text[] not null default '{}',
  line_name text not null,
  line_aliases text[] not null default '{}',
  release_pattern text not null check (release_pattern in ('continuous', 'annual', 'limited', 'unknown')),
  line_attributes jsonb not null default '{}'::jsonb,
  standard_proof numeric(5,1),
  category_phg_id uuid,
  phg_brand_id uuid,
  phg_brand_line_id uuid,
  phg_product_id uuid,
  evidence_urls text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_name, line_name)
);

-- 4) Barcode -> line + size ----------------------------------------------------------
create table if not exists public.discover_line_barcodes (
  gtin text primary key check (gtin ~ '^[0-9]{12,14}$'),
  brand_line_id uuid not null references public.discover_brand_lines(id) on delete cascade,
  package_size_ml numeric,
  source text not null check (source in ('observed_label', 'retailer', 'gs1', 'producer')),
  evidence text,
  created_at timestamptz not null default now()
);
create index if not exists discover_line_barcodes_line_idx on public.discover_line_barcodes(brand_line_id);

-- 5) Releases of a line (the "release" part of the identity) -------------------------
create table if not exists public.discover_line_releases (
  id uuid primary key default gen_random_uuid(),
  brand_line_id uuid not null references public.discover_brand_lines(id) on delete cascade,
  release_key text not null,
  release_label text not null,
  release_year integer,
  release_date date,
  bottling_year integer,
  proof numeric(5,1),
  age_years numeric(4,1),
  informal_batch_label text,
  facts jsonb not null default '{}'::jsonb,
  verification_state text not null check (verification_state in ('url_backed', 'observed_label', 'url_backed_and_observed', 'inferred')),
  evidence_urls text[] not null default '{}',
  phg_release_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_line_id, release_key)
);

-- 6) Test fixtures (real bottles) -----------------------------------------------------
create table if not exists public.discover_identity_fixtures (
  name text primary key,
  input jsonb not null,
  expected jsonb not null,
  evidence text,
  created_at timestamptz not null default now()
);

alter table public.phg_category_term_mirror enable row level security;
alter table public.discover_label_terms enable row level security;
alter table public.discover_brand_lines enable row level security;
alter table public.discover_line_barcodes enable row level security;
alter table public.discover_line_releases enable row level security;
alter table public.discover_identity_fixtures enable row level security;
revoke all on public.phg_category_term_mirror, public.discover_label_terms, public.discover_brand_lines,
  public.discover_line_barcodes, public.discover_line_releases, public.discover_identity_fixtures
  from public, anon, authenticated;
grant all on public.phg_category_term_mirror, public.discover_label_terms, public.discover_brand_lines,
  public.discover_line_barcodes, public.discover_line_releases, public.discover_identity_fixtures
  to service_role;

comment on table public.phg_category_term_mirror is 'Discover-local read-only copy of PHG category_terms; PHG remains canonical.';
comment on table public.discover_label_terms is 'Label word dictionary: which role a phrase plays on a label and the PHG code it maps to.';
comment on table public.discover_brand_lines is 'Brand lines (expressions). Identity = brand + line + release + size.';
comment on table public.discover_line_barcodes is 'Barcode -> brand line + package size, with where the barcode was seen.';
comment on table public.discover_line_releases is 'Releases of a line, told apart by proof, laser lot year and age. Evidence URLs required for url_backed rows.';
comment on table public.discover_identity_fixtures is 'Real-bottle test cases for discover_resolve_bottle.';

-- 7) Small parsers -------------------------------------------------------------------
-- Barcode: digits only, valid GTIN check digit; 13/14-digit forms of a UPC-A come back as 12 digits.
create or replace function public.discover_gtin(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  d text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
  n integer := length(d);
  s integer := 0;
  i integer;
begin
  if n not in (12, 13, 14) then return null; end if;
  for i in 1..n - 1 loop
    s := s + substr(d, n - i, 1)::integer * case when i % 2 = 1 then 3 else 1 end;
  end loop;
  if (10 - s % 10) % 10 <> substr(d, n, 1)::integer then return null; end if;
  while length(d) > 12 and left(d, 1) = '0' loop d := substr(d, 2); end loop;
  return d;
end $$;

create or replace function public.discover_parse_proof(p text)
returns numeric language sql immutable set search_path = '' as $$
  select case when x between 2 and 200 then x end
  from (select (regexp_match(coalesce(p, ''), '(\d{2,3}(?:\.\d{1,2})?)\s*(?:°\s*)?proof', 'i'))[1]::numeric as x) s
$$;

create or replace function public.discover_parse_abv(p text)
returns numeric language sql immutable set search_path = '' as $$
  select case when x > 0 and x <= 100 then x end
  from (select coalesce(
    (regexp_match(coalesce(p, ''), '(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:alc|abv|alcohol|by\s+vol)', 'i'))[1],
    (regexp_match(coalesce(p, ''), 'alc[^0-9%]{0,12}(\d{1,2}(?:\.\d{1,2})?)\s*%', 'i'))[1])::numeric as x) s
$$;

create or replace function public.discover_parse_size_ml(p text)
returns numeric language sql immutable set search_path = '' as $$
  select case when x between 20 and 20000 then x end
  from (select coalesce(
    (regexp_match(coalesce(p, ''), '(\d{2,4}(?:\.\d+)?)\s*m\.?\s*l\.?(?![a-z])', 'i'))[1]::numeric,
    round((regexp_match(coalesce(p, ''), '(\d{1,3}(?:\.\d+)?)\s*c\.?\s*l\.?(?![a-z])', 'i'))[1]::numeric * 10),
    round((regexp_match(coalesce(p, ''), '(?<![0-9.])(\d(?:\.\d{1,3})?)\s*(?:l|lt|ltr|liters?|litres?)(?![a-z0-9])', 'i'))[1]::numeric * 1000)
  ) as x) s
$$;

-- Laser lot code on the glass, e.g. "L25295 01 23:41D" = bottled 2025, day 295 (22 Oct), line 01, 23:41.
-- Format seen on Buffalo Trace / Sazerac bottles: L + 2-digit year + 3-digit day of year.
create or replace function public.discover_parse_lot_code(p text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  m text[];
  y integer;
  d integer;
  last_day integer;
begin
  m := regexp_match(upper(coalesce(p, '')),
    '(?:^|[^A-Z0-9])(L\s?(\d{2})(\d{3})(?:\s?(\d{2}))?(?:\s?(\d{1,2}:\d{2}))?\s?([A-Z])?)(?![A-Z0-9])');
  if m is null then return null; end if;
  y := 2000 + m[2]::integer;
  d := m[3]::integer;
  last_day := (make_date(y, 12, 31) - make_date(y, 1, 1)) + 1;
  if d < 1 or d > last_day then return null; end if;
  return jsonb_build_object('raw', btrim(m[1]), 'format', 'L+YY+DDD', 'year', y, 'day_of_year', d,
    'bottled_on', make_date(y, 1, 1) + (d - 1), 'line', m[4], 'time', m[5], 'shift_code', m[6]);
end $$;

-- 8) Word-role tagger -----------------------------------------------------------------
-- Gives every word on a label a role. Numbers and codes first (proof, ABV, size, age,
-- barcode, lot code, permit), then brand, then that brand's line names, then the
-- dictionary (longest phrase wins), then producer name after "bottled by".
-- Words left over are returned as "unclassified" (often a new line name or prose).
create or replace function public.discover_tag_label(p_text text, p_brand_hint text default null)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  raw text := left(coalesce(p_text, ''), 12000);
  work text;
  m text[];
  r record;
  grp text[];
  acc text;
  s integer;
  e integer;
  v_proof numeric := public.discover_parse_proof(raw);
  v_abv numeric := public.discover_parse_abv(raw);
  v_size numeric := public.discover_parse_size_ml(raw);
  v_age numeric;
  v_gtin text;
  v_lot jsonb := public.discover_parse_lot_code(raw);
  v_permit text;
  toks text[];
  roles text[];
  n integer;
  i integer;
  k integer;
  w integer;
  ok boolean;
  phrase text;
  hit record;
  brand_map jsonb;
  line_map jsonb;
  brand_hits jsonb := '{}'::jsonb;
  line_hits jsonb := '{}'::jsonb;
  line_best jsonb := '{}'::jsonb;
  v_brand text;
  v_brand_source text;
  v_brand_matched text;
  v_line jsonb;
  v_line_cands jsonb := '[]'::jsonb;
  spans jsonb := '[]'::jsonb;
  attrs jsonb := '{}'::jsonb;
  cats jsonb := '[]'::jsonb;
  best_cat jsonb;
  v_producer text;
  run text[] := '{}';
  unclassified text[] := '{}';
  hint_norm text := public.discover_norm(p_brand_hint);
  stop text[] := array['the','a','an','of','and','in','at','by','to','is','was','were','with','for','on','this','that',
    'from','as','it','its','our','we','you','your','are','be','or','each','one','time','more','than','who','which',
    'his','her','their','has','have','had','s','no','not','less','so','all','into','over','after','before','only',
    'also','very','most','every','zqz'];
begin
  -- numbers and codes -----------------------------------------------------------------
  m := regexp_match(raw, '(\d{1,2})\s*(?:-\s*)?(?:years?|yrs?\.?)\s*old', 'i');
  if m is null then m := regexp_match(raw, 'aged\s+(?:for\s+)?(\d{1,2})\s+(?:years?|yrs?)', 'i'); end if;
  if m is not null then v_age := m[1]::numeric; end if;
  for r in select x[1] as g from regexp_matches(raw, '(\d[\d \-]*\d)', 'g') as x loop
    grp := regexp_split_to_array(r.g, '[ \-]+');
    for s in 1..coalesce(array_length(grp, 1), 0) loop
      acc := '';
      for e in s..array_length(grp, 1) loop
        acc := acc || grp[e];
        exit when length(acc) > 14;
        if length(acc) >= 12 then v_gtin := public.discover_gtin(acc); exit when v_gtin is not null; end if;
      end loop;
      exit when v_gtin is not null;
    end loop;
    exit when v_gtin is not null;
  end loop;
  m := regexp_match(raw, 'DSP[\s-]*([A-Z]{2})[\s-]*(\d{1,6})', 'i');
  if m is not null then v_permit := upper('DSP-' || m[1] || '-' || m[2]); end if;

  -- strip what is already read so it is not mistaken for words -----------------------
  work := raw;
  work := regexp_replace(work, 'government\s+warning[\s\S]{0,600}?health\s+problems\.?', ' zqz ', 'gi');
  work := regexp_replace(work, '(?:^|(?<=[^A-Za-z0-9]))L\s?\d{5}(?:\s?\d{2})?(?:\s?\d{1,2}:\d{2})?\s?[A-Z]?(?![A-Za-z0-9])', ' zqz ', 'g');
  work := regexp_replace(work, '[A-Z]\d{2}\.\d{4,9}', ' zqz ', 'g');
  work := regexp_replace(work, 'DSP[\s-]*[A-Z]{2}[\s-]*\d{1,6}', ' zqz ', 'gi');
  work := regexp_replace(work, '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+', ' zqz ', 'g');
  work := regexp_replace(work, '(?:https?://|www\.)\S+', ' zqz ', 'gi');
  work := regexp_replace(work, '\S+\.(?:com|net|org)(?![a-z])\S*', ' zqz ', 'gi');
  work := regexp_replace(work, '\d[\d\s().-]{8,}\d', ' zqz ', 'g');
  work := regexp_replace(work, '\d{2,3}(?:\.\d{1,2})?\s*(?:°\s*)?proof', ' zqz ', 'gi');
  work := regexp_replace(work, '\d{1,2}(?:\.\d{1,2})?\s*%\s*(?:alc\.?|abv|alcohol)?(?:\s*(?:/|by)\s*vol\.?)?', ' zqz ', 'gi');
  work := regexp_replace(work, 'alc\.?\s*/\s*vol\.?', ' zqz ', 'gi');
  work := regexp_replace(work, '\d{2,4}(?:\.\d+)?\s*m\.?\s*l\.?(?![a-z])', ' zqz ', 'gi');
  work := regexp_replace(work, '(?<![0-9.])\d(?:\.\d{1,3})?\s*(?:l|lt|ltr|liters?|litres?)(?![a-z0-9])', ' zqz ', 'gi');
  work := regexp_replace(work, '\d+\s*¢', ' zqz ', 'g');
  work := regexp_replace(work, '\d{1,2}\s*(?:-\s*)?(?:years?|yrs?\.?)\s*old', ' zqz ', 'gi');

  toks := array_remove(regexp_split_to_array(public.discover_norm(work), '\s+'), '');
  n := coalesce(array_length(toks, 1), 0);
  roles := array_fill(null::text, array[greatest(n, 1)]);
  for i in 1..n loop
    if toks[i] = 'zqz' then roles[i] := 'break'; end if;
  end loop;

  -- brand -------------------------------------------------------------------------------
  select coalesce(jsonb_object_agg(k2, b), '{}'::jsonb) into brand_map
  from (select distinct on (public.discover_norm(a)) public.discover_norm(a) as k2, bl.brand_name as b
        from public.discover_brand_lines bl cross join lateral unnest(array[bl.brand_name] || bl.brand_aliases) as a
        where public.discover_norm(a) <> ''
        order by public.discover_norm(a), bl.brand_name) q;
  for i in 1..n loop
    continue when roles[i] is not null;
    for w in reverse least(8, n - i + 1)..1 loop
      ok := true;
      for k in i..i + w - 1 loop if roles[k] is not null then ok := false; exit; end if; end loop;
      continue when not ok;
      phrase := array_to_string(toks[i:i + w - 1], ' ');
      if brand_map ? phrase then
        for k in i..i + w - 1 loop roles[k] := 'brand'; end loop;
        brand_hits := jsonb_set(brand_hits, array[brand_map ->> phrase],
          to_jsonb(coalesce((brand_hits ->> (brand_map ->> phrase))::integer, 0) + 1));
        v_brand_matched := coalesce(v_brand_matched, phrase);
        spans := spans || jsonb_build_object('text', phrase, 'role', 'brand');
        exit;
      end if;
    end loop;
  end loop;
  if hint_norm <> '' and brand_map ? hint_norm then
    v_brand := brand_map ->> hint_norm; v_brand_source := 'reader_brand';
  elsif brand_hits <> '{}'::jsonb then
    select key into v_brand from jsonb_each_text(brand_hits) order by value::integer desc, key limit 1;
    v_brand_source := 'label_words';
  elsif coalesce(btrim(p_brand_hint), '') <> '' then
    v_brand := btrim(p_brand_hint); v_brand_source := 'reader_brand_unregistered';
  end if;

  -- line names of that brand ------------------------------------------------------------
  if v_brand is not null then
    select coalesce(jsonb_object_agg(k2, id::text), '{}'::jsonb) into line_map
    from (select distinct on (public.discover_norm(a)) public.discover_norm(a) as k2, bl.id
          from public.discover_brand_lines bl cross join lateral unnest(array[bl.line_name] || bl.line_aliases) as a
          where bl.brand_name = v_brand and public.discover_norm(a) <> ''
          order by public.discover_norm(a), bl.id) q;
    for i in 1..n loop
      continue when roles[i] is not null;
      for w in reverse least(8, n - i + 1)..1 loop
        ok := true;
        for k in i..i + w - 1 loop if roles[k] is not null then ok := false; exit; end if; end loop;
        continue when not ok;
        phrase := array_to_string(toks[i:i + w - 1], ' ');
        if line_map ? phrase then
          for k in i..i + w - 1 loop roles[k] := 'line'; end loop;
          line_hits := jsonb_set(line_hits, array[line_map ->> phrase],
            to_jsonb(coalesce((line_hits ->> (line_map ->> phrase))::integer, 0) + 1));
          if length(phrase) > length(coalesce(line_best ->> (line_map ->> phrase), '')) then
            line_best := jsonb_set(line_best, array[line_map ->> phrase], to_jsonb(phrase));
          end if;
          spans := spans || jsonb_build_object('text', phrase, 'role', 'line');
          -- a line name can also carry an attribute ("Barrel Proof" = cask strength)
          for hit in select t.maps_to from public.discover_label_terms t
                     where t.active and t.term_norm = phrase and t.role = 'attribute' loop
            if not (coalesce(attrs -> (hit.maps_to ->> 'dimension'), '[]'::jsonb) ? (hit.maps_to ->> 'value')) then
              attrs := jsonb_set(attrs, array[hit.maps_to ->> 'dimension'],
                coalesce(attrs -> (hit.maps_to ->> 'dimension'), '[]'::jsonb) || to_jsonb(hit.maps_to ->> 'value'));
            end if;
          end loop;
          exit;
        end if;
      end loop;
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('id', bl.id, 'name', bl.line_name, 'hits', h.value::integer,
             'matched', line_best ->> h.key) order by h.value::integer desc, length(line_best ->> h.key) desc), '[]'::jsonb)
      into v_line_cands
      from jsonb_each_text(line_hits) h join public.discover_brand_lines bl on bl.id = h.key::uuid;
    if jsonb_array_length(v_line_cands) = 1
       or (jsonb_array_length(v_line_cands) > 1
           and ((v_line_cands -> 0 ->> 'hits')::integer > (v_line_cands -> 1 ->> 'hits')::integer
                or length(v_line_cands -> 0 ->> 'matched') > length(v_line_cands -> 1 ->> 'matched'))) then
      v_line := v_line_cands -> 0;
    end if;
  end if;

  -- dictionary (longest phrase first) ----------------------------------------------------
  for i in 1..n loop
    continue when roles[i] is not null;
    for w in reverse least(8, n - i + 1)..1 loop
      ok := true;
      for k in i..i + w - 1 loop if roles[k] is not null then ok := false; exit; end if; end loop;
      continue when not ok;
      phrase := array_to_string(toks[i:i + w - 1], ' ');
      select t.role, t.maps_to into hit from public.discover_label_terms t
       where t.active and t.term_norm = phrase
       order by t.priority desc, (t.source = 'discover_seed') desc limit 1;
      if found then
        for k in i..i + w - 1 loop roles[k] := hit.role; end loop;
        spans := spans || jsonb_build_object('text', phrase, 'role', hit.role, 'maps_to', hit.maps_to);
        if hit.role = 'category' then
          cats := cats || jsonb_build_object('text', phrase, 'words', w, 'phg_category_id', hit.maps_to ->> 'phg_category_id',
            'legal_class', coalesce((hit.maps_to ->> 'legal_class')::boolean, false));
        elsif hit.role = 'attribute' and hit.maps_to ? 'dimension' then
          if not (coalesce(attrs -> (hit.maps_to ->> 'dimension'), '[]'::jsonb) ? (hit.maps_to ->> 'value')) then
            attrs := jsonb_set(attrs, array[hit.maps_to ->> 'dimension'],
              coalesce(attrs -> (hit.maps_to ->> 'dimension'), '[]'::jsonb) || to_jsonb(hit.maps_to ->> 'value'));
          end if;
        end if;
        exit;
      end if;
    end loop;
  end loop;

  -- producer name: the words right after "distilled ... and bottled by" -----------------
  for i in 1..n loop
    if roles[i] = 'producer_phrase' and (i = n or roles[i + 1] is distinct from 'producer_phrase') then
      k := i + 1; run := '{}';
      while k <= n and roles[k] is null and coalesce(array_length(run, 1), 0) < 6 loop
        run := run || toks[k]; roles[k] := 'producer'; k := k + 1;
      end loop;
      if coalesce(array_length(run, 1), 0) > 0 then
        v_producer := coalesce(v_producer, array_to_string(run, ' '));
        spans := spans || jsonb_build_object('text', array_to_string(run, ' '), 'role', 'producer');
      end if;
    end if;
  end loop;

  -- leftovers ----------------------------------------------------------------------------
  run := '{}';
  for i in 1..n + 1 loop
    if i <= n and roles[i] is null and not (toks[i] = any(stop)) and toks[i] !~ '^[0-9]+$' then
      run := run || toks[i];
    else
      if coalesce(array_length(run, 1), 0) > 0 then
        if not (array_to_string(run, ' ') = any(unclassified)) and coalesce(array_length(unclassified, 1), 0) < 30 then
          unclassified := unclassified || array_to_string(run, ' ');
        end if;
        run := '{}';
      end if;
    end if;
  end loop;

  select c.v || jsonb_build_object('name', pc.name, 'slug', pc.slug, 'path', pc.path) into best_cat
  from jsonb_array_elements(cats) as c(v)
  left join public.phg_category_mirror pc on pc.phg_category_id = nullif(c.v ->> 'phg_category_id', '')::uuid
  order by (c.v ->> 'words')::integer desc, (c.v ->> 'legal_class')::boolean desc, pc.level desc nulls last
  limit 1;

  return jsonb_build_object(
    'brand', v_brand, 'brand_source', v_brand_source, 'brand_matched', v_brand_matched,
    'line', v_line, 'line_candidates', v_line_cands,
    'category', best_cat, 'categories', cats, 'attributes', attrs,
    'proof', v_proof, 'abv_percent', v_abv, 'size_ml', v_size, 'age_years', v_age,
    'gtin', v_gtin, 'lot', v_lot, 'permit', v_permit, 'producer', v_producer,
    'unclassified', to_jsonb(unclassified), 'spans', spans, 'token_count', n);
end $$;

-- 9) Resolver: brand + line + release + size -------------------------------------------
create or replace function public.discover_resolve_bottle(p jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  tags jsonb;
  ptags jsonb;
  v_gtin text;
  bc public.discover_line_barcodes%rowtype;
  ln public.discover_brand_lines%rowtype;
  v_words_line uuid;
  v_line_source text;
  v_proof numeric;
  v_size numeric;
  v_age numeric;
  v_lot jsonb;
  v_lot_year integer;
  reasons text[] := '{}';
  flags text[] := '{}';
  cands jsonb := '[]'::jsonb;
  v_count integer := 0;
  rel jsonb;
  v_status text;
  v_attrs jsonb;
  v_key text;
begin
  tags := public.discover_tag_label(concat_ws(' zqz ', p ->> 'brand', p ->> 'product', p ->> 'text'), p ->> 'brand');

  v_gtin := coalesce(public.discover_gtin(p ->> 'gtin'), tags ->> 'gtin');
  if v_gtin is not null then
    select * into bc from public.discover_line_barcodes where gtin = v_gtin;
  end if;
  v_words_line := nullif(tags #>> '{line,id}', '')::uuid;
  if bc.gtin is not null then
    select * into ln from public.discover_brand_lines where id = bc.brand_line_id;
    v_line_source := 'barcode';
    reasons := reasons || format('barcode %s = %s %s', v_gtin, ln.brand_name, ln.line_name);
    if v_words_line is not null and v_words_line <> ln.id then flags := flags || 'barcode_and_label_words_disagree'::text; end if;
  elsif v_words_line is not null then
    select * into ln from public.discover_brand_lines where id = v_words_line;
    v_line_source := 'label_words';
    reasons := reasons || format('label words "%s" = %s line', tags #>> '{line,matched}', ln.line_name);
    if v_gtin is not null then flags := flags || 'barcode_not_registered'::text; end if;
  elsif jsonb_array_length(coalesce(tags -> 'line_candidates', '[]'::jsonb)) > 1 then
    flags := flags || 'several_line_names_on_label'::text;
  end if;

  v_proof := coalesce(public.discover_parse_proof(p ->> 'proof'),
    case when (p ->> 'proof') ~ '^\s*\d{2,3}(\.\d{1,2})?\s*$' then btrim(p ->> 'proof')::numeric end,
    (tags ->> 'proof')::numeric, round((tags ->> 'abv_percent')::numeric * 2, 1));
  v_size := coalesce(public.discover_parse_size_ml(p ->> 'size'), (tags ->> 'size_ml')::numeric, bc.package_size_ml);
  v_age := coalesce(substring(p ->> 'age' from '(\d{1,2})')::numeric, (tags ->> 'age_years')::numeric);
  v_lot := coalesce(public.discover_parse_lot_code(p ->> 'lot_code'), nullif(tags -> 'lot', 'null'::jsonb));
  v_lot_year := (v_lot ->> 'year')::integer;
  if v_lot_year is not null and v_lot_year > extract(year from now())::integer then
    flags := flags || 'lot_year_in_future'::text; v_lot_year := null;
  end if;

  if ln.id is null then
    v_status := 'line_unknown';
  elsif ln.release_pattern = 'continuous' then
    v_status := 'matched';
    rel := jsonb_build_object('key', 'standard', 'label', 'Standard bottling (no separate releases)');
    reasons := reasons || 'continuous line: the laser code dates this bottle, it does not pick a release'::text;
    if ln.standard_proof is not null and v_proof is not null and abs(ln.standard_proof - v_proof) > 0.05 then
      flags := flags || 'proof_differs_from_line_standard'::text;
    end if;
  else
    select coalesce(jsonb_agg(jsonb_build_object('key', r.release_key, 'label', r.release_label, 'year', r.release_year,
             'proof', r.proof, 'age_years', r.age_years, 'informal_batch_label', r.informal_batch_label,
             'verification', r.verification_state) order by r.release_year, r.proof), '[]'::jsonb), count(*)
      into cands, v_count
      from public.discover_line_releases r
     where r.brand_line_id = ln.id
       and (v_proof is null or r.proof is null or abs(r.proof - v_proof) <= 0.05)
       and (v_lot_year is null
            or (r.bottling_year is not null and r.bottling_year = v_lot_year)
            or (r.bottling_year is null and r.release_year is not null and v_lot_year between r.release_year - 1 and r.release_year))
       and (v_age is null or r.age_years is null or r.age_years = v_age);
    if v_count = 1 then
      v_status := 'matched';
      rel := cands -> 0;
      reasons := reasons || format('release "%s" fits proof %s and laser year %s', rel ->> 'label',
        coalesce(v_proof::text, 'unread'), coalesce(v_lot_year::text, 'unread'));
    elsif v_count > 1 then
      v_status := 'ambiguous';
      reasons := reasons || format('%s releases fit; %s would settle it', v_count,
        case when v_lot_year is null then 'the laser code on the glass' when v_proof is null then 'the proof' else 'the age statement' end);
    else
      v_status := 'new_release_candidate';
      reasons := reasons || format('no known %s release has proof %s with laser year %s', ln.line_name,
        coalesce(v_proof::text, 'unread'), coalesce(v_lot_year::text, 'unread'));
    end if;
  end if;

  if nullif(btrim(p ->> 'product'), '') is not null then
    ptags := public.discover_tag_label(p ->> 'product', null);
    if jsonb_array_length(coalesce(ptags -> 'categories', '[]'::jsonb)) > 0
       and jsonb_array_length(coalesce(ptags -> 'unclassified', '[]'::jsonb)) = 0
       and coalesce(ptags -> 'attributes', '{}'::jsonb) = '{}'::jsonb then
      flags := flags || 'reader_product_is_only_category_words'::text;
    end if;
  end if;

  select coalesce(jsonb_object_agg(dim, vals), '{}'::jsonb) into v_attrs
  from (select dim, jsonb_agg(distinct v order by v) as vals
        from (select a.key as dim, x.v
                from jsonb_each(coalesce(tags -> 'attributes', '{}'::jsonb)) a
                cross join lateral jsonb_array_elements_text(a.value) as x(v)
              union
              select a.key, x.v
                from jsonb_each(coalesce(ln.line_attributes, '{}'::jsonb)) a
                cross join lateral jsonb_array_elements_text(a.value) as x(v)) u
        group by dim) q;

  if v_status = 'matched' and v_size is not null then
    v_key := concat_ws('|', public.discover_norm(ln.brand_name), public.discover_norm(ln.line_name), rel ->> 'key',
      trim(to_char(v_size, 'FM99990')) || 'ml');
  end if;

  return jsonb_build_object(
    'status', v_status,
    'brand', coalesce(ln.brand_name, tags ->> 'brand'),
    'line', ln.line_name,
    'line_source', v_line_source,
    'release', rel,
    'release_candidates', case when v_status = 'ambiguous' then v_count end,
    'candidates', case when v_status = 'ambiguous' then cands end,
    'size_ml', v_size, 'proof', v_proof, 'age_years', v_age, 'gtin', v_gtin, 'lot', v_lot,
    'category', tags -> 'category', 'attributes', v_attrs,
    'producer', tags ->> 'producer', 'permit', tags ->> 'permit',
    'identity_key', v_key, 'identity_hash', case when v_key is not null then md5(v_key) end,
    'reasons', to_jsonb(reasons), 'flags', to_jsonb(flags),
    'unclassified_words', tags -> 'unclassified',
    'resolver_version', 'discover-identity-0.1.0');
end $$;

-- 10) Keep the dictionary in step with the PHG term copy --------------------------------
create or replace function public.discover_refresh_label_terms_from_phg()
returns integer language plpgsql set search_path = '' as $$
declare v integer;
begin
  delete from public.discover_label_terms where source = 'phg_category_terms';
  insert into public.discover_label_terms(term, role, maps_to, source, source_ref, priority)
  select m.term,
         case m.term_kind when 'exclusion' then 'exclusion' when 'brand' then 'brand_hint' when 'modifier' then 'modifier' else 'category' end,
         jsonb_build_object('phg_category_id', m.phg_category_id, 'term_kind', m.term_kind, 'match_type', m.match_type),
         'phg_category_terms', m.phg_category_term_id::text, m.priority
  from public.phg_category_term_mirror m
  where m.active and m.term_norm <> ''
  on conflict do nothing;
  get diagnostics v = row_count;
  return v;
end $$;

-- Dictionary rows that point at a PHG code the mirror does not have.
create or replace function public.discover_label_dictionary_problems()
returns table(term text, role text, problem text) language sql stable set search_path = '' as $$
  select t.term, t.role, 'attribute code not in PHG mirror: ' || (t.maps_to ->> 'dimension') || '.' || (t.maps_to ->> 'value')
  from public.discover_label_terms t
  where t.role = 'attribute' and not exists (
    select 1 from public.phg_attribute_value_mirror v
    where v.dimension_code = t.maps_to ->> 'dimension' and v.code = t.maps_to ->> 'value' and v.active)
  union all
  select t.term, t.role, 'category not in PHG mirror: ' || (t.maps_to ->> 'phg_category_id')
  from public.discover_label_terms t
  where t.role = 'category' and t.source = 'discover_seed' and not exists (
    select 1 from public.phg_category_mirror c where c.phg_category_id::text = t.maps_to ->> 'phg_category_id')
$$;

-- 11) Fixture runner -----------------------------------------------------------------------
-- expected keys are dotted paths into the resolver output ("release.key"), or "flag:<name>".
create or replace function public.discover_run_identity_fixtures()
returns table(fixture text, pass boolean, mismatches jsonb, got jsonb)
language sql stable set search_path = '' as $$
  with r as (
    select f.name, f.expected, public.discover_resolve_bottle(f.input) as got
    from public.discover_identity_fixtures f
  ), checks as (
    select r.name, e.key, e.value as want,
      case when e.key like 'flag:%' then to_jsonb(coalesce(r.got -> 'flags', '[]'::jsonb) ? substr(e.key, 6))
           else r.got #> string_to_array(e.key, '.') end as have
    from r cross join lateral jsonb_each(r.expected) e
  )
  select r.name,
    not exists (select 1 from checks c where c.name = r.name and c.have is distinct from c.want),
    coalesce((select jsonb_object_agg(c.key, jsonb_build_object('want', c.want, 'got', c.have))
              from checks c where c.name = r.name and c.have is distinct from c.want), '{}'::jsonb),
    r.got
  from r order by r.name
$$;

revoke all on function public.discover_gtin(text), public.discover_parse_proof(text), public.discover_parse_abv(text),
  public.discover_parse_size_ml(text), public.discover_parse_lot_code(text), public.discover_tag_label(text, text),
  public.discover_resolve_bottle(jsonb), public.discover_refresh_label_terms_from_phg(),
  public.discover_label_dictionary_problems(), public.discover_run_identity_fixtures()
  from public, anon, authenticated;
grant execute on function public.discover_gtin(text), public.discover_parse_proof(text), public.discover_parse_abv(text),
  public.discover_parse_size_ml(text), public.discover_parse_lot_code(text), public.discover_tag_label(text, text),
  public.discover_resolve_bottle(jsonb), public.discover_refresh_label_terms_from_phg(),
  public.discover_label_dictionary_problems(), public.discover_run_identity_fixtures()
  to service_role;
