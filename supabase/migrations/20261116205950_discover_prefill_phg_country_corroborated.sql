-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116205950 "discover_prefill_phg_country_corroborated" was applied live but was never committed to the repo.

-- A brand's country is copied only when its own US label (sure match) says the same place
-- (spot check: one brand was filed under the wrong country).
do $$
declare d text; old_c text; new_c text;
begin
  d := pg_get_functiondef('public.discover_prefill_from_phg(uuid)'::regprocedure);
  old_c := $q$select id, 'country', coalesce(nullif(country,''), case when public.discover_us_state(origin) and label_tier = 'strong' then 'United States' end),$q$;
  new_c := $q$select id, 'country', case when label_tier <> 'strong' or origin is null then null
                          when (public.discover_us_state(origin) or origin = 'american') then case when nullif(country,'') is null or country ~* '^united states' then 'United States' end
                          when lower(country) = lower(origin) then country end,$q$;
  if position(old_c in d) = 0 then raise exception 'country clause not found'; end if;
  d := replace(d, old_c, new_c);
  execute d;
end $$;
revoke all on function public.discover_prefill_from_phg(uuid) from public, anon, authenticated;

create or replace function public.discover_company_case(p text) returns text language sql immutable as $$
  select string_agg(case when w ~ '^([A-Za-z]\.){2,}[,]?$' then upper(w)
                         when w ~ '^[A-Z&]{2,4}[.,]?$' and (w !~ '[AEIOU]' or w ~ '^(USA|LLC|LTD|INC|CO|LP|LLP|PLC|SA|SPA|SRL|AG|GMBH|BV|NV)[.,]?$')
                         then case when w ~* '^(ltd|inc|co)[.,]?$' then initcap(w) else w end
                         else initcap(w) end, ' ' order by i)
  from unnest(string_to_array(coalesce(p, ''), ' ')) with ordinality t(w, i)
$$;

with e as (select id from public.discover_product_evidence where metadata->>'source' = 'harmony' and attribute_code in ('country','bottler','importer')),
a as (delete from public.discover_product_attributes where evidence_id in (select id from e) returning 1)
delete from public.discover_product_evidence where id in (select id from e);
select public.discover_prefill_from_phg();
