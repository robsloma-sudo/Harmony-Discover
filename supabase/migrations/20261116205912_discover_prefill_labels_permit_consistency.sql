-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116205912 "discover_prefill_labels_permit_consistency" was applied live but was never committed to the repo.

do $$
declare d text;
begin
  d := pg_get_functiondef('public.discover_prefill_from_labels(uuid)'::regprocedure);
  d := replace(d, 'and public.discover_nums(d.product_name) = public.discover_nums(c.product)) specific,',
                  'and public.discover_nums(d.product_name) = public.discover_nums(c.product)
          -- a home-made bottle approved on an importer''s permit (or the reverse) is someone else''s label
          and c.permit_no is not null
          and ((public.discover_us_state(c.origin) or c.origin = ''american'') = (c.permit_no !~ ''-I-''))) specific,');
  if position('someone else''s label' in d) = 0 then raise exception 'patch failed'; end if;
  execute d;
end $$;
revoke all on function public.discover_prefill_from_labels(uuid) from public, anon, authenticated;

-- remove detail facts and packages that no longer pass
with bad as (
  select d.id from public.discover_products d join public.discover_product_label_facts c on c.discover_product_id = d.id
   where c.permit_no is null or ((public.discover_us_state(c.origin) or c.origin = 'american') <> (c.permit_no !~ '-I-'))),
e as (select e.id from public.discover_product_evidence e where e.metadata->>'source' = 'harmony_labels'
       and e.attribute_code in ('alcohol_statement','age_statement','vintage','appellation','grapes') and e.discover_product_id in (select id from bad)),
a as (delete from public.discover_product_attributes where evidence_id in (select id from e) returning 1),
x as (delete from public.discover_product_evidence where id in (select id from e) returning 1)
delete from public.discover_product_packages k where k.discover_product_id in (select id from bad) and k.package_payload->>'source' = 'harmony_labels';
