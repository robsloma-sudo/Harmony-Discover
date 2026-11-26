-- ROLLBACK for 20261126140000_discover_merge_package_clash.sql (Discover DEV lqqmwqrffelgnbngrkep only).
-- Restores discover_merge_product and discover_merge_duplicates exactly as they were live on 26 Nov 2026
-- (copied from pg_get_functiondef), then removes the helper discover_merge_try and the discover_merge_skips log.
-- Note: after this the job fails again on the first clashing package (as before); merges already done stay done
-- (their snapshots are in discover_product_merges).

create or replace function public.discover_merge_product(p_from uuid, p_into uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $function$
declare a record;
begin
  if p_from = p_into then return; end if;
  insert into discover_product_merges(from_product_id, into_product_id, reason, snapshot)
  select p_from, p_into, p_reason, jsonb_build_object('product', to_jsonb(p),
    'attributes', coalesce((select jsonb_agg(to_jsonb(x)) from discover_product_attributes x where x.discover_product_id = p_from), '[]'::jsonb))
  from discover_products p where p.id = p_from;
  if not found then return; end if;

  update discover_product_evidence set discover_product_id = p_into where discover_product_id = p_from;
  -- Facts: keep the more confident value for each kind of fact.
  for a in select * from discover_product_attributes where discover_product_id = p_from loop
    if exists (select 1 from discover_product_attributes t where t.discover_product_id = p_into and t.attribute_code = a.attribute_code) then
      update discover_product_attributes t set value_text = a.value_text, value_numeric = a.value_numeric, value_json = a.value_json,
             unit = a.unit, state = a.state, confidence = a.confidence, evidence_id = a.evidence_id, updated_at = now()
       where t.discover_product_id = p_into and t.attribute_code = a.attribute_code
         and coalesce(a.confidence, 0) > coalesce(t.confidence, 0);
      delete from discover_product_attributes where id = a.id;
    else
      update discover_product_attributes set discover_product_id = p_into where id = a.id;
    end if;
  end loop;
  update discover_product_packages set discover_product_id = p_into where discover_product_id = p_from;
  update bottle_sightings set discover_product_id = p_into where discover_product_id = p_from;
  update discover_phg_export_queue set discover_product_id = p_into where discover_product_id = p_from;
  delete from discover_enrichment_jobs j where j.discover_product_id = p_from and j.status in ('queued','processing','retry')
    and exists (select 1 from discover_enrichment_jobs k where k.discover_product_id = p_into and k.job_type = j.job_type and k.status in ('queued','processing','retry'));
  update discover_enrichment_jobs set discover_product_id = p_into where discover_product_id = p_from;
  insert into discover_product_search_usage (discover_product_id, searches, research_runs, last_research_at)
  select p_into, searches, research_runs, last_research_at from discover_product_search_usage where discover_product_id = p_from
  on conflict (discover_product_id) do update set searches = discover_product_search_usage.searches + excluded.searches,
    research_runs = discover_product_search_usage.research_runs + excluded.research_runs,
    last_research_at = greatest(discover_product_search_usage.last_research_at, excluded.last_research_at);
  update discover_research_outcomes set discover_product_id = p_into where discover_product_id = p_from;
  update discover_products t set first_seen_at = least(t.first_seen_at, f.first_seen_at), last_seen_at = greatest(t.last_seen_at, f.last_seen_at),
         upc_gtin = coalesce(t.upc_gtin, f.upc_gtin), ean = coalesce(t.ean, f.ean), updated_at = now()
    from discover_products f where t.id = p_into and f.id = p_from;
  delete from discover_products where id = p_from;
end $function$;

create or replace function public.discover_merge_duplicates()
returns integer language plpgsql security definer set search_path = public as $function$
declare d record; n integer := 0;
begin
  for d in
    select p.id, coalesce(
      (select k.id from discover_products k join discover_brand_lines l on l.id = k.discover_line_id
        where k.discover_line_id = p.discover_line_id and k.status = 'identified' and l.release_pattern = 'continuous'
          and coalesce(k.identity_payload #>> '{release,key}', 'standard') = 'standard' order by k.created_at limit 1),
      (select k.id from discover_products k where k.discover_line_id = p.discover_line_id and k.status = 'candidate'
        order by (select count(*) from discover_product_attributes a where a.discover_product_id = k.id) desc, k.created_at limit 1)) as keep_id
    from discover_products p where p.status = 'candidate' and p.discover_line_id is not null
  loop
    if d.keep_id is not null and d.keep_id <> d.id and exists (select 1 from discover_products where id = d.id) then
      perform discover_merge_product(d.id, d.keep_id, 'same line'); n := n + 1;
    end if;
  end loop;
  for d in
    select p.id, first_value(p.id) over w as keep_id, row_number() over w as rn
    from discover_products p
    where p.status = 'candidate' and p.discover_line_id is null
      and (discover_product_core_key(p.product_name) <> '' or nullif(btrim(coalesce(p.product_name, '')), '') is null)
    window w as (partition by discover_norm(p.brand_name), discover_product_core_key(p.product_name),
                   (discover_product_core_key(p.product_name) = '')
                 order by (select count(*) from discover_product_attributes a where a.discover_product_id = p.id) desc, p.created_at)
  loop
    if d.rn > 1 then perform discover_merge_product(d.id, d.keep_id, 'same name'); n := n + 1; end if;
  end loop;
  return n;
end $function$;

drop function if exists public.discover_merge_try(uuid, uuid, text);
drop table if exists public.discover_merge_skips;
