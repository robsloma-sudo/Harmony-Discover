create or replace function harmony_sync.stage_eligible_menu_observations(p_limit integer default 100)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public, harmony_sync
as $$
declare
  v_obs record;
  v_payload jsonb;
  v_evidence jsonb;
  v_hash text;
  v_key text;
  v_version integer;
  v_candidate_id uuid;
  v_count integer := 0;
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception 'p_limit must be between 1 and 500';
  end if;

  for v_obs in
    with latest_consent as (
      select distinct on (subject_id)
        id, subject_id, policy_version, granted, withdrawn_at
      from public.learning_consent_records
      where purpose = 'aggregate_research'
      order by subject_id, seq desc, recorded_at desc
    )
    select
      o.id, o.venue_name_read, o.venue_name_submitted, o.capture_source,
      o.captured_at, o.processing_notice_version, o.min_ocr_confidence,
      c.id as consent_record_id, c.policy_version,
      (select count(*)::integer from public.observation_item_corrections x where x.observation_id = o.id) as correction_count
    from public.menu_observations o
    join latest_consent c on c.subject_id = o.consumer_id
    where o.status = 'complete'
      and o.consent_to_processing is true
      and o.consent_to_contribute is true
      and o.venue_confirmed is true
      and o.all_pages_complete is true
      and o.disputed is false
      and o.unresolved_flags = 0
      and o.structured_menu_saved is true
      and c.granted is true
      and c.withdrawn_at is null
      and not exists (
        select 1 from harmony_sync.staged_candidates s
        where s.source_system = 'harmony_discover'
          and s.source_table = 'menu_observations'
          and s.source_record_id = o.id
          and s.source_version = 1 + (
            select count(*)::integer from public.observation_item_corrections x where x.observation_id = o.id
          )
          and s.entity_type = 'menu_observation'
      )
    order by o.captured_at, o.id
    limit p_limit
  loop
    v_version := 1 + v_obs.correction_count;

    select jsonb_build_object(
      'venue_name', coalesce(v_obs.venue_name_read, v_obs.venue_name_submitted),
      'captured_at', v_obs.captured_at,
      'capture_source', v_obs.capture_source,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'source_item_id', i.id, 'page_index', i.page_index, 'position', i.position,
          'section', i.section, 'name', i.name, 'description', i.description,
          'price_text', i.price_text, 'beverage_category', i.beverage_category,
          'listed_ingredients', i.listed_ingredients, 'evidence_state', i.evidence_state,
          'text_verified', i.text_verified,
          'latest_correction', (
            select x.after_values from public.observation_item_corrections x
            where x.observation_id = i.observation_id and x.item_id = i.id
            order by x.created_at desc, x.id desc limit 1
          )
        ) order by i.page_index, i.position, i.id)
        from public.observation_items i where i.observation_id = v_obs.id
      ), '[]'::jsonb)
    ) into v_payload;

    v_evidence := jsonb_build_object(
      'capture_timestamp', v_obs.captured_at,
      'processing_notice_version', v_obs.processing_notice_version,
      'aggregate_research_consent_record_id', v_obs.consent_record_id,
      'aggregate_research_policy_version', v_obs.policy_version,
      'venue_confirmed', true, 'all_pages_complete', true,
      'disputed', false, 'unresolved_flags', 0,
      'correction_count', v_obs.correction_count
    );

    v_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
    v_key := 'harmony_discover:menu_observations:' || v_obs.id::text || ':' || v_version::text;

    insert into harmony_sync.staged_candidates (
      contract_version, source_system, source_project_ref, source_table,
      source_record_id, source_version, entity_type, payload, evidence,
      evidence_state, confidence, permission_basis, permission_reference,
      payload_hash, idempotency_key
    ) values (
      '0.1.0', 'harmony_discover', 'lqqmwqrffelgnbngrkep',
      'menu_observations', v_obs.id, v_version, 'menu_observation',
      v_payload, v_evidence, 'menu_observed', v_obs.min_ocr_confidence,
      'explicit_contribution_consent',
      v_obs.consent_record_id::text || ':' || v_obs.policy_version,
      v_hash, v_key
    )
    on conflict (idempotency_key) do nothing
    returning id into v_candidate_id;

    if v_candidate_id is not null then
      insert into harmony_sync.review_events (
        staged_candidate_id, event_type, prior_status, new_status,
        actor_label, reason, payload_hash, contract_version
      ) values (
        v_candidate_id, 'staged', null, 'pending',
        'consent-gated-Discover-stage-job',
        'Explicit per-observation contribution plus current aggregate-research consent; venue confirmed; complete, non-disputed observation.',
        v_hash, '0.1.0'
      );
      insert into harmony_sync.sync_ledger (staged_candidate_id, status)
      values (v_candidate_id, 'blocked');
      v_count := v_count + 1;
    end if;
    v_candidate_id := null;
  end loop;
  return v_count;
end;
$$;
revoke all on function harmony_sync.stage_eligible_menu_observations(integer) from public, anon, authenticated;
grant execute on function harmony_sync.stage_eligible_menu_observations(integer) to service_role;