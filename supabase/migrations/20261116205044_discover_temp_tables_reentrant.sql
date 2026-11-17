-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116205044 "discover_temp_tables_reentrant" was applied live but was never committed to the repo.

do $$
declare d text; fn text; t text;
begin
  foreach fn in array array['public.discover_link_phg(uuid)', 'public.discover_prefill_from_phg(uuid)', 'public.discover_prefill_from_labels(uuid)'] loop
    d := pg_get_functiondef(fn::regprocedure);
    foreach t in array array['_dp', '_bm', '_m', '_f', '_lp', '_lf'] loop
      d := replace(d, '  create temp table ' || t || ' on commit drop', '  drop table if exists pg_temp.' || t || '; create temp table ' || t || ' on commit drop');
      d := replace(d, '  create temp table ' || t || ' (', '  drop table if exists pg_temp.' || t || '; create temp table ' || t || ' (');
    end loop;
    execute d;
  end loop;
end $$;
revoke all on function public.discover_link_phg(uuid) from public, anon, authenticated;
revoke all on function public.discover_prefill_from_phg(uuid) from public, anon, authenticated;
revoke all on function public.discover_prefill_from_labels(uuid) from public, anon, authenticated;
