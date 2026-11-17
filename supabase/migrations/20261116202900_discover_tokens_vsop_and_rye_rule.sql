-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116202900 "discover_tokens_vsop_and_rye_rule" was applied live but was never committed to the repo.

create or replace function public.discover_tokens(p text, p_drop text[] default '{}'::text[]) returns text[]
language sql immutable set search_path = public, extensions as $function$
  select coalesce(array_agg(distinct t order by t), '{}') from unnest(string_to_array(public.discover_norm(
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(p,'')),
        '(\d)\s*(yo|yr|yrs|year|years)\M', '\1', 'g'),
        '\mv\.?\s?s\.?\s?o\.?\s?p\M\.?', 'vsop', 'g'),
        '\mx\.\s?o\M\.?', 'xo', 'g'),
        '\mvery special\M|\mv\.?s\M\.?', 'vs', 'g')), ' ')) t
  where t <> '' and t <> all(p_drop) and t <> all(array['the','of','de','la','and','old','aged','year','years','yo','single','straight',
    'kentucky','bourbon','whiskey','whisky','tequila','vodka','gin','rum','cognac','brandy','liqueur','wine','ml','l','proof','original','edition','bottle',
    'blended','scotch','classic','originale'])
$function$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.discover_link_phg(uuid)'::regprocedure);
  d := replace(d, 'when dn is not null and pn is null then 0',
                  'when dn is not null and pn is null then 0
                     when (''rye'' = any(dt)) <> (''rye'' = any(pt)) then 0');
  execute d;
end $$;
revoke all on function public.discover_link_phg(uuid) from public, anon, authenticated;
select public.discover_tokens('Hennessy V.S.O.P Privilege', array['hennessy']) a, public.discover_tokens('X.O', '{}') b, public.discover_tokens('Very Special Cognac', '{}') c, public.discover_tokens('V.S', '{}') d2;
