-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116205011 "discover_prefill_phg_skip_barrel_proof_abv" was applied live but was never committed to the repo.

do $$
declare d text;
begin
  d := pg_get_functiondef('public.discover_prefill_from_phg(uuid)'::regprocedure);
  if position('from lp where abv between 0.1 and 96' in d) = 0 then raise exception 'anchor not found'; end if;
  d := replace(d, 'from lp where abv between 0.1 and 96',
                  'from lp where abv between 0.1 and 96 and coalesce(name, '''') !~* ''(barrel proof|cask strength|barrel strength|full proof|batch proof|uncut)''');
  execute d;
end $$;
revoke all on function public.discover_prefill_from_phg(uuid) from public, anon, authenticated;
with e as (select e.id from public.discover_product_evidence e join public.discover_products d on d.id = e.discover_product_id
           where e.metadata->>'source' = 'harmony' and e.attribute_code = 'alcohol_statement'
             and (d.product_name ~* '(barrel proof|cask strength|barrel strength|full proof|batch proof)'
                  or exists (select 1 from public.discover_phg_products p where p.phg_product_id = d.phg_match_product_id and p.name ~* '(barrel proof|cask strength|barrel strength|full proof|batch proof)'))),
a as (delete from public.discover_product_attributes where evidence_id in (select id from e) returning 1)
delete from public.discover_product_evidence where id in (select id from e);
