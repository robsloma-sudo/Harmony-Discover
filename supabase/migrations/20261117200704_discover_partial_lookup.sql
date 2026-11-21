-- Partial evidence, step 1 (Rob, 17 Nov 2026): a label that is partly hidden or cut off still shows some
-- words or part-words. They are looked up together across the brand AND the product name
-- ("TAYLO" + "CURED" -> Colonel E.H. Taylor Cured Oak), instead of one word at a time against brands only
-- (which ranked plain "Taylor" first). Sources: US label approvals and the Harmony catalogue (canonical data
-- only; Discover's own unreviewed products are not used). This returns candidate names only. The app scores
-- them, adds what this scan session and the checked-in venue already show, and at most says "Probably …".
-- Nothing is saved from here.
create or replace function public.discover_partial_lookup(p_anchors text[], p_limit int default 150)
returns table(brand text, product text, class_type text, labels int, anchors_matched int, source text)
language sql stable security definer set search_path = public, extensions as $$
  with a as (
    select distinct regexp_replace(lower(public.discover_ocr_fix(x)), '[^a-z0-9]', '', 'g') t
      from unnest(coalesce(p_anchors, '{}'::text[])) x
  ), anchors as (
    -- Readers drop the apostrophe in names like MAKER'S, so "makers" also looks for "maker's".
    select t, array['%' || t || '%'] || case when t like '%s' and length(t) >= 5
             then array['%' || left(t, -1) || '''s%', '%' || left(t, -1) || '’s%'] else '{}'::text[] end pats
      from a where length(t) between 4 and 30 order by length(t) desc, t limit 6
  ), pats as (
    select array_agg(p) p from anchors, unnest(anchors.pats) p
  ), hit as (
    select c.brand, c.product, c.class_type, c.search_text
      from public.discover_label_catalog c, pats
     where pats.p is not null and c.brand is not null and c.search_text like any (pats.p)
  ), grouped as (
    select mode() within group (order by h.brand) brand, mode() within group (order by h.product) product,
           mode() within group (order by h.class_type) class_type, count(*)::int labels, max(h.search_text) st
      from hit h group by lower(h.brand), lower(coalesce(h.product, ''))
  ), harmony as (
    select p.brand, p.name product, coalesce(nullif(p.category, ''), p.class) class_type,
           lower(coalesce(p.brand, '') || ' ' || coalesce(p.name, '')) st
      from public.discover_phg_products p, pats
     where pats.p is not null and p.brand is not null
       and lower(coalesce(p.brand, '') || ' ' || coalesce(p.name, '')) like any (pats.p)
  )
  select u.brand, u.product, u.class_type, u.labels,
         (select count(*) from anchors an where u.st like any (an.pats))::int anchors_matched, u.source
    from (select g.brand, g.product, g.class_type, g.labels, g.st, 'label'::text source from grouped g
          union all select h.brand, h.product, h.class_type, 1, h.st, 'harmony'::text from harmony h) u
   order by 5 desc, u.labels desc, u.brand, u.product
   limit greatest(1, least(coalesce(p_limit, 150), 300));
$$;
revoke all on function public.discover_partial_lookup(text[], int) from public, anon;
grant execute on function public.discover_partial_lookup(text[], int) to authenticated, service_role;
comment on function public.discover_partial_lookup(text[], int) is
  'Partial-evidence candidates: label approval and Harmony names containing any of up to 6 part-words (4+ letters). Read-only; used for the "Probably …" hint only.';
