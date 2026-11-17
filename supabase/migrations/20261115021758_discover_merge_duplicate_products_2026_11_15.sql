-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261115021758 "discover_merge_duplicate_products_2026_11_15" was applied live but was never committed to the repo.

-- One-off clean-up (Rob OK'd 15 Nov 2026): fold duplicate shared records together. Logged in discover_product_merges.
do $$
declare ln record; keep uuid; d record;
begin
  -- 1) Products on a known line: unresolved copies fold into one record per line
  --    (the resolved standard record for continuous lines; otherwise the copy with the most facts).
  --    Resolved release-specific records (e.g. a dated Barrel Proof batch) stay separate.
  for ln in select l.* from discover_brand_lines l where exists (select 1 from discover_products p where p.discover_line_id = l.id and p.status = 'candidate') loop
    keep := null;
    if ln.release_pattern = 'continuous' then
      select p.id into keep from discover_products p where p.discover_line_id = ln.id and p.status = 'identified'
        and coalesce(p.identity_payload #>> '{release,key}', 'standard') = 'standard' order by p.created_at limit 1;
    end if;
    if keep is null then
      select p.id into keep from discover_products p where p.discover_line_id = ln.id and p.status = 'candidate'
       order by (select count(*) from discover_product_attributes a where a.discover_product_id = p.id) desc, p.created_at limit 1;
      update discover_products set brand_name = ln.brand_name, product_name = ln.line_name, updated_at = now() where id = keep;
    end if;
    for d in select p.id from discover_products p where p.discover_line_id = ln.id and p.status = 'candidate' and p.id <> keep loop
      perform discover_merge_product(d.id, keep, 'same line: ' || ln.brand_name || ' ' || ln.line_name);
    end loop;
  end loop;
  -- 2) Other unresolved copies with exactly the same brand + product name (accents and punctuation ignored).
  for d in
    select p.id, first_value(p.id) over w as keep_id, row_number() over w as rn
    from discover_products p
    where p.status = 'candidate' and p.discover_line_id is null
    window w as (partition by discover_norm(p.brand_name), discover_norm(coalesce(p.product_name, ''))
                 order by (select count(*) from discover_product_attributes a where a.discover_product_id = p.id) desc, p.created_at)
  loop
    if d.rn > 1 then perform discover_merge_product(d.id, d.keep_id, 'same name'); end if;
  end loop;
end $$;
