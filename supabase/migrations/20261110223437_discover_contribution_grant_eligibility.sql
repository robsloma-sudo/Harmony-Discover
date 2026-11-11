create or replace function public.discover_grant_observation_contribution(
  p_subject uuid, p_observation uuid, p_policy_version text
) returns uuid
language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  v_grant uuid;
begin
  if p_subject is null or p_observation is null or p_policy_version is null
     or char_length(trim(p_policy_version)) < 1 or char_length(trim(p_policy_version)) > 120 then
    raise exception 'invalid_contribution_grant' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.menu_observations o
    where o.id = p_observation and o.consumer_id = p_subject
      and o.status = 'ready_for_review'
      and o.consent_to_processing is true
      and o.venue_confirmed is true
      and o.all_pages_complete is true
      and o.structured_menu_saved is true
      and o.disputed is false
      and o.unresolved_flags = 0
  ) then
    raise exception 'observation_not_eligible' using errcode = '42501';
  end if;
  insert into public.observation_contribution_grants(observation_id,consumer_id,policy_version)
  values (p_observation,p_subject,trim(p_policy_version))
  returning id into v_grant;
  insert into public.observation_contribution_grant_events(grant_id,observation_id,consumer_id,event_type,policy_version)
  values(v_grant,p_observation,p_subject,'granted',trim(p_policy_version));
  return v_grant;
end;
$$;
revoke all on function public.discover_grant_observation_contribution(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.discover_grant_observation_contribution(uuid,uuid,text) to service_role;