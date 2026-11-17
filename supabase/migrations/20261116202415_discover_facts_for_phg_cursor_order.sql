-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116202415 "discover_facts_for_phg_cursor_order" was applied live but was never committed to the repo.

create or replace function public.discover_facts_for_phg(p_after timestamptz default '-infinity', p_limit int default 2000) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.updated_at), '[]'::jsonb) from (
    select * from (
      select distinct on (d.phg_product_id, a.attribute_code)
             d.phg_product_id product_id, a.attribute_code attribute, a.value_text value, a.confidence,
             coalesce(e.source_type, 'other') source_type, e.source_url, d.id discover_product_id, a.updated_at
        from public.discover_product_attributes a
        join public.discover_products d on d.id = a.discover_product_id
        left join public.discover_product_evidence e on e.id = a.evidence_id
       where d.phg_product_id is not null and d.phg_link_method in ('auto_barcode','auto_name','manual')
         and a.state = 'found' and nullif(a.value_text,'') is not null
         and coalesce(e.metadata->>'source','') <> 'harmony' and a.updated_at > p_after
       order by d.phg_product_id, a.attribute_code, a.confidence desc nulls last, a.updated_at desc) y
    order by y.updated_at limit greatest(1, least(p_limit, 5000))) x
$$;
revoke all on function public.discover_facts_for_phg(timestamptz, int) from public, anon, authenticated;
