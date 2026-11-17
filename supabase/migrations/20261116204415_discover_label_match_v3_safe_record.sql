-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116204415 "discover_label_match_v3_safe_record" was applied live but was never committed to the repo.

do $$
declare d text;
begin
  d := pg_get_functiondef('public.discover_label_match(uuid)'::regprocedure);
  d := replace(d, 'top record; v_phg_ttb text;', 'top record; v_best text; v_best_sim real; v_phg_ttb text;');
  d := replace(d, '    if found and top.similarity >= 0.8 then',
                  '    if found then v_best := top.brand || '' / '' || coalesce(top.product, ''''); v_best_sim := top.similarity; end if;
    if found and top.similarity >= 0.8 then');
  d := replace(d, '''best'', top.brand || '' / '' || coalesce(top.product, ''''), ''similarity'', top.similarity', '''best'', v_best, ''similarity'', v_best_sim');
  execute d;
end $$;
revoke all on function public.discover_label_match(uuid) from public, anon, authenticated;
delete from public.discover_cola_detail_wanted where sent_at is null;
update public.discover_products set cola_ttb_id = null, cola_match_score = null, cola_matched_at = null where cola_ttb_id is not null;
