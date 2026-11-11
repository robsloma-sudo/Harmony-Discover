-- Reconcile the canonical Discover observation quality gate.
-- Venue confirmation is a consumer-confirmed venue name, not a resolved venue UUID.
-- Retain the existing 0.90 minimum OCR-confidence threshold.

create or replace function public.discover_observation_qualifies(
  o public.menu_observations,
  p_min_confidence numeric default 0.9
) returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    o.all_pages_complete is true
    and coalesce(o.min_ocr_confidence, 0) >= p_min_confidence
    and o.unresolved_flags = 0
    and o.disputed is false
    and o.structured_menu_saved is true
    and o.venue_confirmed is true
    and nullif(btrim(coalesce(o.venue_name_submitted, o.venue_name_read)), '') is not null,
    false
  );
$$;

create or replace function public.discover_grant_observation_contribution(
  p_subject uuid, p_observation uuid, p_policy_version text
) returns uuid
language plpgsql
security invoker
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
    where o.id = p_observation
      and o.consumer_id = p_subject
      and o.status = 'ready_for_review'
      and o.consent_to_processing is true
      and public.discover_observation_qualifies(o)
  ) then
    raise exception 'observation_not_eligible' using errcode = '42501';
  end if;

  insert into public.observation_contribution_grants(observation_id,consumer_id,policy_version)
  values (p_observation,p_subject,trim(p_policy_version))
  returning id into v_grant;

  insert into public.observation_contribution_grant_events(
    grant_id,observation_id,consumer_id,event_type,policy_version
  ) values (v_grant,p_observation,p_subject,'granted',trim(p_policy_version));

  return v_grant;
end;
$$;

revoke all on function public.discover_grant_observation_contribution(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.discover_grant_observation_contribution(uuid,uuid,text)
  to service_role;

create or replace function harmony_sync.stage_eligible_menu_observations(
  p_limit integer default 100
) returns integer
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
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'p_limit must be between 1 and 500';
  end if;

  for v_obs in
    select
      o.id, o.venue_name_read, o.venue_name_submitted, o.capture_source,
      o.captured_at, o.processing_notice_version, o.min_ocr_confidence,
      g.id as grant_id, g.policy_version,
      (select count(*)::integer from public.observation_item_corrections x
       where x.observation_id = o.id) as correction_count
    from public.menu_observations o
    join public.observation_contribution_grants g
      on g.observation_id = o.id and g.consumer_id = o.consumer_id
    where o.status = 'ready_for_review'
      and o.consent_to_processing is true
      and public.discover_observation_qualifies(o)
      and g.withdrawn_at is null
      and not exists (
        select 1 from harmony_sync.staged_candidates s
        where s.source_system = 'harmony_discover'
          and s.source_table = 'menu_observations'
          and s.source_record_id = o.id
          and s.source_version = 1 + (
            select count(*)::integer from public.observation_item_corrections x
            where x.observation_id = o.id
          )
          and s.entity_type = 'menu_observation'
      )
    order by o.captured_at, o.id
    limit p_limit
  loop
    v_version := 1 + v_obs.correction_count;

    select jsonb_build_object(
      'venue_name', coalesce(v_obs.venue_name_submitted, v_obs.venue_name_read),
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
      'contribution_grant_id', v_obs.grant_id,
      'contribution_policy_version', v_obs.policy_version,
      'venue_confirmed', true,
      'venue_confirmation_basis', 'consumer_confirmed_name',
      'all_pages_complete', true,
      'min_ocr_confidence', v_obs.min_ocr_confidence,
      'min_ocr_confidence_required', 0.9,
      'quality_gate_version', 'discover-observation-quality-v1',
      'disputed', false,
      'unresolved_flags', 0,
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
      v_obs.grant_id::text || ':' || v_obs.policy_version,
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
        'Explicit observation-specific contribution grant; consumer-confirmed venue; complete, high-confidence, non-disputed observation.',
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

revoke all on function harmony_sync.stage_eligible_menu_observations(integer)
  from public, anon, authenticated;
grant execute on function harmony_sync.stage_eligible_menu_observations(integer)
  to service_role;
