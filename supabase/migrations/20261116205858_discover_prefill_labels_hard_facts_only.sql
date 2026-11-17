-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116205858 "discover_prefill_labels_hard_facts_only" was applied live but was never committed to the repo.

-- Label detail extras that come from automatic picture reading (age, grains, finish) proved unreliable on spot checks
-- (e.g. a blanco "finished in barrels"). Keep only regulator facts: ABV, age only when the bottle's own name states it,
-- and wine vintage / appellation / grapes for wines.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.discover_prefill_from_labels(uuid)'::regprocedure);
  d := replace(d, 'where specific and aged_years between 1 and 80 and (cardinality(public.discover_nums(product_name)) = 0 or aged_years::text = any(public.discover_nums(product_name)))',
                  'where specific and aged_years between 1 and 80 and aged_years::text = any(public.discover_nums(product_name))');
  d := replace(d, 'from _lp where specific and cardinality(grains) > 0 and not (''grain (generic)'' = any(grains))', 'from _lp where false');
  d := replace(d, 'from _lp where specific and nullif(finishing,'''') is not null', 'from _lp where false');
  d := replace(d, 'from _lp where specific and vintage between 1900 and 2100', 'from _lp where specific and is_wine and vintage between 1900 and 2100');
  d := replace(d, 'from _lp where specific and nullif(appellation,'''') is not null', 'from _lp where specific and is_wine and nullif(appellation,'''') is not null');
  d := replace(d, 'from _lp where specific and cardinality(varietals) > 0', 'from _lp where specific and is_wine and cardinality(varietals) > 0');
  d := replace(d, 'select d.id, d.product_name, d.cola_ttb_id ttb, d.cola_match_score sc,',
                  'select d.id, d.product_name, d.cola_ttb_id ttb, d.cola_match_score sc, public.discover_kind_family(d.product_class) = ''wine'' is_wine,');
  if position('is_wine and vintage' in d) = 0 or position('from _lp where false' in d) = 0 then raise exception 'patch failed'; end if;
  execute d;
end $$;
revoke all on function public.discover_prefill_from_labels(uuid) from public, anon, authenticated;

with e as (select e.id from public.discover_product_evidence e join public.discover_products d on d.id = e.discover_product_id
           where e.metadata->>'source' = 'harmony_labels'
             and (e.attribute_code in ('grain','cask_finish')
                  or (e.attribute_code in ('vintage','appellation','grapes') and public.discover_kind_family(d.product_class) is distinct from 'wine')
                  or (e.attribute_code = 'age_statement'
                      and not exists (select 1 from public.discover_product_attributes a where a.evidence_id = e.id
                                      and substring(a.value_text from '(\d+)') = any(public.discover_nums(d.product_name)))))),
a as (delete from public.discover_product_attributes where evidence_id in (select id from e) returning 1)
delete from public.discover_product_evidence where id in (select id from e);
