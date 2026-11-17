-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116202758 "discover_prefill_use_match_product" was applied live but was never committed to the repo.

do $$
declare d text;
begin
  d := pg_get_functiondef('public.discover_prefill_from_phg(uuid)'::regprocedure);
  d := replace(d, 'p.phg_product_id = d.phg_product_id', 'p.phg_product_id = d.phg_match_product_id');
  d := replace(d, 'where d.phg_product_id is null and d.category_phg_id is null', 'where d.phg_match_product_id is null and d.category_phg_id is null');
  execute d;
  d := pg_get_functiondef('public.discover_facts_for_phg(timestamptz,int)'::regprocedure);
  d := replace(d, 'd.phg_product_id', 'd.phg_match_product_id');
  execute d;
end $$;
revoke all on function public.discover_prefill_from_phg(uuid) from public, anon, authenticated;
revoke all on function public.discover_facts_for_phg(timestamptz, int) from public, anon, authenticated;
