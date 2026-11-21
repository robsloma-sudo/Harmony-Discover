-- Fix kit S1-A4-001 (also covers the Discover part of S2-B4-003 and S3-C4-001).
-- Live state checked 2026-11-20 on Discover dev (lqqmwqrffelgnbngrkep):
--   35 public tables/views where anon and/or authenticated hold TRUNCATE (and anon holds INSERT/UPDATE/DELETE).
--   Default privileges for role postgres in schema public hand anon+authenticated arwdDxtm on every new table.
--
-- What this does (permissions only):
--   1. Future tables: stop handing TRUNCATE/REFERENCES/TRIGGER to anon+authenticated, and stop handing
--      INSERT/UPDATE/DELETE to anon. (authenticated keeps default I/U/D; RLS still governs it.)
--   2. Existing objects: remove TRUNCATE/REFERENCES/TRIGGER from anon+authenticated; remove INSERT/UPDATE/DELETE
--      from anon; remove from authenticated only the write commands that have NO row rule allowing them.
--   SELECT is left unchanged. service_role and postgres are untouched.
--
-- Expected behaviour change for the app: none. Every write removed here is already blocked by row rules
-- (RLS is on for all 33 tables and no rule allows the removed command); TRUNCATE ignores row rules, which is the hole.

begin;

-- 1. Default privileges (root cause)
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke insert, update, delete on tables from anon;

-- 2. Existing objects
do $$
declare
  t text;
  all_objs text[] := array[
    'bartender_comedy_evaluations','bartender_memories','bartender_voice_consents',
    'discover_bag_keys','discover_brand_bags','discover_cola_detail_wanted','discover_cola_details',
    'discover_font_catalog','discover_kind_category_map','discover_product_label_facts','discover_product_merges',
    'discover_product_search_usage','discover_products_link_backup_20261116','discover_research_hints',
    'discover_research_outcomes','discover_research_playbook_fields','discover_research_playbook_sources',
    'discover_scan_timings','discover_shape_observations','discover_shape_profiles',
    'learning_consent_records','learning_deletion_requests','learning_events','learning_improvement_proposals',
    'learning_outcome_measurements','learning_question_records','learning_research_tasks','learning_trend_candidates',
    'menu_observations','observation_assets','observation_extractions','observation_items','observation_jobs',
    'observation_processing_events','personal_taste_profiles'];
  -- objects where authenticated has NO insert/update/delete row rule at all
  auth_no_writes text[] := array[
    'discover_bag_keys','discover_brand_bags','discover_cola_detail_wanted','discover_cola_details',
    'discover_font_catalog','discover_kind_category_map','discover_product_label_facts','discover_product_merges',
    'discover_product_search_usage','discover_products_link_backup_20261116','discover_research_hints',
    'discover_research_outcomes','discover_research_playbook_fields','discover_research_playbook_sources',
    'discover_scan_timings','discover_shape_observations','discover_shape_profiles',
    'learning_consent_records','learning_deletion_requests','learning_events','learning_improvement_proposals',
    'learning_outcome_measurements','learning_question_records','learning_research_tasks','learning_trend_candidates',
    'menu_observations','observation_assets','observation_extractions','observation_items','observation_jobs',
    'observation_processing_events'];
begin
  foreach t in array all_objs loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t);
    execute format('revoke insert, update, delete on public.%I from anon', t);
  end loop;
  foreach t in array auth_no_writes loop
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- Tables with some owner-only row rules: keep the commands the rules allow, drop the rest.
revoke update on public.bartender_comedy_evaluations from authenticated;  -- rules: select/insert/delete
revoke delete on public.bartender_voice_consents from authenticated;      -- rules: select/insert/update
revoke delete on public.personal_taste_profiles from authenticated;       -- rules: select/insert/update
-- bartender_memories: rules exist for all four commands, authenticated keeps select/insert/update/delete.

commit;

-- Check (read-only): should return zero rows after this runs.
-- select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
-- where n.nspname='public' and c.relkind in ('r','p','v','m','f')
--   and (has_table_privilege('anon',c.oid,'TRUNCATE') or has_table_privilege('authenticated',c.oid,'TRUNCATE')
--     or has_table_privilege('anon',c.oid,'INSERT') or has_table_privilege('anon',c.oid,'UPDATE')
--     or has_table_privilege('anon',c.oid,'DELETE'));
