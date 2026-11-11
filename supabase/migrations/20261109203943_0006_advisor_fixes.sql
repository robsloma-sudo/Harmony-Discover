-- DEVELOPMENT ONLY. Discover DEV project. Fixes from the Supabase advisors on first apply (9 Nov 2026).
-- 1. auth_rls_initplan (WARN x5): evaluate auth.uid() once per query, not once per row. Same rules, same owners.
drop policy if exists "consumer reads own observations" on public.menu_observations;
create policy "consumer reads own observations" on public.menu_observations
  for select to authenticated using ((select auth.uid()) = consumer_id);
drop policy if exists "consumer reads own asset metadata" on public.observation_assets;
create policy "consumer reads own asset metadata" on public.observation_assets
  for select to authenticated using ((select auth.uid()) = consumer_id);
drop policy if exists "taste profile owner select" on public.personal_taste_profiles;
create policy "taste profile owner select" on public.personal_taste_profiles
  for select to authenticated using ((select auth.uid()) = subject_id);
drop policy if exists "taste profile owner insert" on public.personal_taste_profiles;
create policy "taste profile owner insert" on public.personal_taste_profiles
  for insert to authenticated with check ((select auth.uid()) = subject_id);
drop policy if exists "taste profile owner update" on public.personal_taste_profiles;
create policy "taste profile owner update" on public.personal_taste_profiles
  for update to authenticated using ((select auth.uid()) = subject_id) with check ((select auth.uid()) = subject_id);
-- 2. unindexed_foreign_keys (INFO x7): also needed for fast account deletion cascades.
create index if not exists learning_improvement_proposals_research_task_idx on public.learning_improvement_proposals(research_task_id);
create index if not exists learning_outcome_measurements_proposal_idx on public.learning_outcome_measurements(proposal_id);
create index if not exists learning_research_tasks_trend_candidate_idx on public.learning_research_tasks(trend_candidate_id);
create index if not exists observation_assets_consumer_idx on public.observation_assets(consumer_id);
create index if not exists observation_extractions_observation_idx on public.observation_extractions(observation_id);
create index if not exists observation_processing_events_asset_idx on public.observation_processing_events(asset_id);
create index if not exists observation_processing_events_observation_idx on public.observation_processing_events(observation_id);