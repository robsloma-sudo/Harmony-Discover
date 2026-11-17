-- Fix: PostgreSQL regex repeat counts max out at 255; strip the government warning with a shortest match instead.

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
  work := regexp_replace(work, 'government\s+?warning[\s\S]*?health\s+?problems\.?', ' zqz ', 'gi');
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

revoke all on function public.discover_tag_label(text, text) from public, anon, authenticated;
grant execute on function public.discover_tag_label(text, text) to service_role;
