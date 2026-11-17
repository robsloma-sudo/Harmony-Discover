-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116205003 "discover_prefill_labels_skip_barrel_proof_abv" was applied live but was never committed to the repo.

do $$
declare d text;
begin
  d := pg_get_functiondef('public.discover_prefill_from_labels(uuid)'::regprocedure);
  d := replace(d, 'from _lp where specific and abv between 0.1 and 96',
                  'from _lp where specific and abv between 0.1 and 96 and coalesce(product_name, '''') !~* ''(barrel proof|cask strength|barrel strength|full proof|batch proof|uncut|unfiltered proof)''');
  execute d;
end $$;
revoke all on function public.discover_prefill_from_labels(uuid) from public, anon, authenticated;
with e as (select e.id from public.discover_product_evidence e join public.discover_products d on d.id = e.discover_product_id
           where e.metadata->>'source' = 'harmony_labels' and e.attribute_code = 'alcohol_statement'
             and d.product_name ~* '(barrel proof|cask strength|barrel strength|full proof|batch proof)'),
a as (delete from public.discover_product_attributes where evidence_id in (select id from e) returning 1)
delete from public.discover_product_evidence where id in (select id from e);
update public.discover_product_packages k set abv_percent = null, updated_at = now()
  from public.discover_products d where d.id = k.discover_product_id and d.product_name ~* '(barrel proof|cask strength|barrel strength|full proof|batch proof)';
