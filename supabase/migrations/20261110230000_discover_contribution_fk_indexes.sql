create index if not exists bartender_comedy_evaluations_user_id_idx
  on public.bartender_comedy_evaluations(user_id);

create index if not exists observation_contribution_grant_events_grant_id_idx
  on public.observation_contribution_grant_events(grant_id);
create index if not exists observation_contribution_grant_events_observation_id_idx
  on public.observation_contribution_grant_events(observation_id);
create index if not exists observation_contribution_grant_events_consumer_id_idx
  on public.observation_contribution_grant_events(consumer_id);

create index if not exists observation_contribution_grants_consumer_id_idx
  on public.observation_contribution_grants(consumer_id);