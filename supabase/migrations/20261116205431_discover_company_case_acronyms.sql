-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116205431 "discover_company_case_acronyms" was applied live but was never committed to the repo.

create or replace function public.discover_company_case(p text) returns text language sql immutable as $$
  select string_agg(case when w ~ '^[A-Z&]{2,4}[.,]?$' and (w !~ '[AEIOU]' or w ~ '^(USA|LLC|LTD|INC|CO|LP|LLP|PLC|SA|SPA|SRL|AG|GMBH|BV|NV)[.,]?$')
                         then case when w ~* '^(ltd|inc|co)[.,]?$' then initcap(w) else w end
                         else initcap(w) end, ' ' order by i)
  from unnest(string_to_array(coalesce(p, ''), ' ')) with ordinality t(w, i)
$$;
select public.discover_company_case('MHW, LTD.') a, public.discover_company_case('MOET HENNESSY USA, INC.') b, public.discover_company_case('JOHN DEWAR & SONS COMPANY') c, public.discover_company_case('SAZERAC CO.') d, public.discover_company_case('CROWN IMPORTS') e;
