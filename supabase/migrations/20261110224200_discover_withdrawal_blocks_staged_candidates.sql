create or replace function public.discover_withdraw_observation_contribution(
  p_subject uuid, p_observation uuid
) returns boolean
language plpgsql security invoker
set search_path = pg_catalog, public, harmony_sync
as $$
declare
  v_grant public.observation_contribution_grants%rowtype;
  v_candidate record;
begin
  if p_subject is null or p_observation is null then
    raise exception 'invalid_contribution_withdrawal' using errcode = '22023';
  end if;
  select * into v_grant
  from public.observation_contribution_grants
  where observation_id=p_observation and consumer_id=p_subject and withdrawn_at is null
  for update;
  if not found then return false; end if;

  update public.observation_contribution_grants
  set withdrawn_at=now(), updated_at=now()
  where id=v_grant.id;

  insert into public.observation_contribution_grant_events(grant_id,observation_id,consumer_id,event_type,policy_version)
  values(v_grant.id,p_observation,p_subject,'withdrawn',v_grant.policy_version);

  for v_candidate in
    select id,review_status,payload_hash,contract_version
    from harmony_sync.staged_candidates
    where source_system='harmony_discover'
      and source_table='menu_observations'
      and source_record_id=p_observation
      and promoted_at is null
      and review_status in ('pending','approved','conflict')
    for update
  loop
    update harmony_sync.staged_candidates
    set review_status='withdrawn',
        review_reason='Contributor withdrew observation-specific permission.',
        reviewed_by='consumer-withdrawal',
        reviewed_at=now(),
        updated_at=now()
    where id=v_candidate.id;

    insert into harmony_sync.review_events(
      staged_candidate_id,event_type,prior_status,new_status,
      actor_label,reason,payload_hash,contract_version
    ) values (
      v_candidate.id,'withdrawn',v_candidate.review_status,'withdrawn',
      'consumer-withdrawal','Observation-specific contribution permission withdrawn.',
      v_candidate.payload_hash,v_candidate.contract_version
    );

    update harmony_sync.sync_ledger
    set status='blocked',last_error_code='permission_withdrawn',updated_at=now()
    where staged_candidate_id=v_candidate.id;
  end loop;
  return true;
end;
$$;
revoke all on function public.discover_withdraw_observation_contribution(uuid,uuid) from public, anon, authenticated;
grant execute on function public.discover_withdraw_observation_contribution(uuid,uuid) to service_role;