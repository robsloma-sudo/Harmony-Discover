-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261115050625 "discover_ongoing_dedup_and_category_word_saves" was applied live but was never committed to the repo.

-- 1) The name of a product without words that only say what kind of drink it is ("101 Bourbon Whiskey" -> "101").
create or replace function public.discover_product_core(p_product text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(
    ' ' || discover_norm(coalesce(p_product, '')) || ' ',
    '( (whiskey|whisky|bourbon|kentucky|straight|tennessee|vodka|tequila|rum|gin|beer|lager|liqueur|spirit|spirits|blended|american|canadian|scotch|irish|the|original))+(?= )', ' ', 'g'))
$$;
-- Postgres regex has no lookahead in replace with this form; use a word loop instead.
create or replace function public.discover_product_core(p_product text)
returns text language sql immutable set search_path = public as $$
  select coalesce(string_agg(w, ' ' order by i), '')
  from unnest(string_to_array(discover_norm(coalesce(p_product, '')), ' ')) with ordinality as t(w, i)
  where w <> '' and w not in ('whiskey','whisky','bourbon','kentucky','straight','tennessee','vodka','tequila','rum','gin',
    'beer','lager','liqueur','spirit','spirits','blended','american','canadian','scotch','irish','the','original');
$$;

-- 2) Unresolved copies of the same bottle (same brand, same name once drink-kind words are ignored) fold together.
--    Runs every 10 minutes; each merge is logged in discover_product_merges with an undo snapshot.
create or replace function public.discover_merge_duplicates()
returns integer language plpgsql security definer set search_path = public as $$
declare d record; n integer := 0;
begin
  -- On a known line: into the line's record (resolved standard record for continuous lines, else the fullest copy).
  for d in
    select p.id, coalesce(
      (select k.id from discover_products k join discover_brand_lines l on l.id = k.discover_line_id
        where k.discover_line_id = p.discover_line_id and k.status = 'identified' and l.release_pattern = 'continuous'
          and coalesce(k.identity_payload #>> '{release,key}', 'standard') = 'standard' order by k.created_at limit 1),
      (select k.id from discover_products k where k.discover_line_id = p.discover_line_id and k.status = 'candidate'
        order by (select count(*) from discover_product_attributes a where a.discover_product_id = k.id) desc, k.created_at limit 1)) as keep_id
    from discover_products p where p.status = 'candidate' and p.discover_line_id is not null
  loop
    if d.keep_id is not null and d.keep_id <> d.id then perform discover_merge_product(d.id, d.keep_id, 'same line'); n := n + 1; end if;
  end loop;
  -- Same brand + same core name.
  for d in
    select p.id, first_value(p.id) over w as keep_id, row_number() over w as rn
    from discover_products p
    where p.status = 'candidate' and p.discover_line_id is null
    window w as (partition by discover_norm(p.brand_name), discover_product_core(p.product_name)
                 order by (select count(*) from discover_product_attributes a where a.discover_product_id = p.id) desc, p.created_at)
  loop
    if d.rn > 1 then perform discover_merge_product(d.id, d.keep_id, 'same name'); n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.discover_merge_duplicates() from public, anon, authenticated;
select cron.schedule('discover-merge-duplicates', '*/10 * * * *', $$select public.discover_merge_duplicates()$$);

-- 3) A read whose product words only name the kind of drink ("1800 Tequila", "Metaxa Ouzo", "Wild Turkey 101 Bourbon
--    Whiskey") is still saved: it attaches by name like any unresolved read instead of being left without a record.
do $$
declare src text;
begin
  src := pg_get_functiondef('public.discover_attach_resolved_sighting'::regproc);
  src := replace(src,
    $old$  if v_flags ? 'reader_product_is_only_category_words' and nullif(p_resolved ->> 'line', '') is null then
    return query select null::uuid, false, 'category_words_only'::text, v_shape;
    return;
  end if;
$old$, '');
  execute src;
end $$;

-- 4) Card research backs off when it stops finding anything new.
alter table public.discover_product_search_usage add column if not exists empty_runs integer not null default 0;
alter table public.discover_product_search_usage add column if not exists next_research_at timestamptz;
create or replace function public.discover_note_research_result(p_product uuid, p_new_facts integer)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_empty integer; v_next timestamptz;
begin
  insert into discover_product_search_usage (discover_product_id) values (p_product) on conflict do nothing;
  update discover_product_search_usage
     set empty_runs = case when p_new_facts > 0 then 0 else empty_runs + 1 end
   where discover_product_id = p_product returning empty_runs into v_empty;
  -- 15 minutes, then 1 hour, 1 day, 1 week, 30 days after runs that find nothing new.
  v_next := now() + case least(v_empty, 4) when 0 then interval '15 minutes' when 1 then interval '1 hour'
                      when 2 then interval '1 day' when 3 then interval '7 days' else interval '30 days' end;
  update discover_product_search_usage set next_research_at = v_next where discover_product_id = p_product;
  return v_next;
end $$;
revoke all on function public.discover_note_research_result(uuid, integer) from public, anon, authenticated;
