-- ROLLBACK for 20261120180000_security_revoke_public_truncate_and_writes.sql
-- Puts every right back exactly as it was on 2026-11-20 (before the fix). Do not run unless undoing the fix.

begin;

alter default privileges for role postgres in schema public
  grant insert, update, delete, truncate, references, trigger on tables to anon;
alter default privileges for role postgres in schema public
  grant truncate, references, trigger on tables to authenticated;

do $$
declare
  t text;
  had_anon text[] := array[
    'discover_bag_keys','discover_brand_bags','discover_cola_detail_wanted','discover_cola_details',
    'discover_font_catalog','discover_kind_category_map','discover_product_label_facts','discover_product_merges',
    'discover_product_search_usage','discover_products_link_backup_20261116','discover_research_hints',
    'discover_research_outcomes','discover_research_playbook_fields','discover_research_playbook_sources',
    'discover_scan_timings','discover_shape_observations','discover_shape_profiles',
    'learning_consent_records','learning_deletion_requests','learning_events','learning_improvement_proposals',
    'learning_outcome_measurements','learning_question_records','learning_research_tasks','learning_trend_candidates',
    'menu_observations','observation_assets','observation_extractions','observation_items','observation_jobs',
    'observation_processing_events','personal_taste_profiles'];
  bartender text[] := array['bartender_comedy_evaluations','bartender_memories','bartender_voice_consents'];
begin
  -- these 32 had full rights for both roles
  foreach t in array had_anon loop
    execute format('grant insert, update, delete, truncate, references, trigger on public.%I to anon, authenticated', t);
  end loop;
  -- the 3 bartender tables had full rights for authenticated only (anon had none)
  foreach t in array bartender loop
    execute format('grant insert, update, delete, truncate, references, trigger on public.%I to authenticated', t);
  end loop;
end $$;

commit;
