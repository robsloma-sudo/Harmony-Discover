-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116203142 "discover_prefill_sizes_all_skus" was applied live but was never committed to the repo.

create or replace function public.discover_size_txt(p numeric) returns text language sql immutable as $$
  select case when p >= 1000 then public.discover_num_txt(round(p / 1000.0, 3)) || ' L' else public.discover_num_txt(p) || ' ml' end
$$;

do $$
declare d text; old_size text; new_size text;
begin
  d := pg_get_functiondef('public.discover_prefill_from_phg(uuid)'::regprocedure);
  old_size := $q$select id, 'size', case when size_ml >= 1000 then discover_num_txt(round(size_ml / 1000.0, 3)) || ' L' else discover_num_txt(size_ml) || ' ml' end,
           'other', 'Harmony catalogue', null, 0.9, 'corroborated', phg_code from lp where size_ml between 10 and 30000$q$;
  new_size := $q$select id, 'size', (select string_agg(public.discover_size_txt(s), ', ' order by s) from (select distinct q.size_ml s from public.discover_phg_products q
                 where q.phg_brand_id = lp.phg_brand_id and q.name_norm = lp.name_norm and q.size_ml between 10 and 30000) z),
           'other', 'Harmony catalogue (sizes listed)', null, 0.9, 'corroborated', phg_code from lp$q$;
  if position(old_size in d) = 0 then raise exception 'size clause not found'; end if;
  d := replace(d, old_size, new_size);
  execute d;
end $$;
revoke all on function public.discover_prefill_from_phg(uuid) from public, anon, authenticated;

with e as (select id from public.discover_product_evidence where metadata->>'source'='harmony' and attribute_code='size'),
a as (delete from public.discover_product_attributes where evidence_id in (select id from e) returning 1)
delete from public.discover_product_evidence where id in (select id from e);
