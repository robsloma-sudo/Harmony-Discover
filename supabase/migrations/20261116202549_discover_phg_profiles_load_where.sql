-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116202549 "discover_phg_profiles_load_where" was applied live but was never committed to the repo.

create or replace function public.discover_phg_profiles_load(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $function$
declare n int;
begin
  delete from public.discover_phg_brand_profiles where true;
  insert into public.discover_phg_brand_profiles(phg_brand_id, brand, version, ten_second, thirty_second, history, producer, production, style, pronunciation)
  select (r->>'brand_id')::uuid, r->>'brand', (r->>'version')::int, r->>'ten_second', r->>'thirty_second', r->'history', r->'producer', r->'production', r->'style', r->>'pronunciation'
  from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count; return n;
end $function$;
revoke all on function public.discover_phg_profiles_load(jsonb) from public, anon, authenticated;
