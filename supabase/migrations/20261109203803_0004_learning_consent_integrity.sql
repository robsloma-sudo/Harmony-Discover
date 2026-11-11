-- DEVELOPMENT ONLY. Apply ONLY to the separate Harmony Discover DEV project. Never to Harmony production.
-- Phase 1 (handoff §10.3): consent is resolved, written and enforced inside the database.
--  * Latest decision per purpose is exact (DISTINCT ON), with a total order (seq) so ties cannot occur.
--  * A consent change is one transaction for all three purposes (all-or-nothing).
--  * Consent writes and event ingestion take the same per-subject transaction lock, so an event that
--    arrives while a revocation is being written waits, then sees the revocation (no race window).
--  * Revoking a purpose clears that purpose's flag on the subject's past events (withdrawal propagation).
--  * Only service_role may execute these functions; there are no client policies on the raw tables.

alter table public.learning_consent_records add column if not exists seq bigint generated always as identity;
create unique index if not exists learning_consent_records_seq_idx on public.learning_consent_records(seq);
create index if not exists learning_consent_latest_idx on public.learning_consent_records(subject_id, purpose, seq desc);
create index if not exists learning_events_subject_idx on public.learning_events(subject_id);

-- Serialises every consent write and event ingest for one subject (released at transaction end).
create or replace function public.learning_subject_lock(p_subject uuid) returns void
language sql volatile set search_path = public, pg_temp as $$
  select pg_advisory_xact_lock(hashtextextended('discover-learning:' || p_subject::text, 0));
$$;

create or replace function public.learning_current_consent(p_subject uuid)
returns table(personalization boolean, aggregate_research boolean, conversation_analysis boolean, policy_version text, recorded_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  with latest as (
    select distinct on (purpose) purpose, granted, withdrawn_at, policy_version, recorded_at
    from public.learning_consent_records where subject_id = p_subject
    order by purpose, seq desc
  )
  select
    coalesce(bool_or(purpose = 'personalization'       and granted and withdrawn_at is null), false),
    coalesce(bool_or(purpose = 'aggregate_research'    and granted and withdrawn_at is null), false),
    coalesce(bool_or(purpose = 'conversation_analysis' and granted and withdrawn_at is null), false),
    coalesce(string_agg(policy_version, '|' order by purpose), 'none'),
    max(recorded_at)
  from latest;
$$;

create or replace function public.learning_set_consent(
  p_subject uuid, p_policy_version text, p_personalization boolean, p_aggregate_research boolean,
  p_conversation_analysis boolean, p_capture_source text default 'discover_app')
returns table(personalization boolean, aggregate_research boolean, conversation_analysis boolean, policy_version text, recorded_at timestamptz)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_now timestamptz := clock_timestamp();
begin
  if p_subject is null or coalesce(trim(p_policy_version), '') = '' or length(p_policy_version) > 40 then
    raise exception 'invalid_consent_request' using errcode = '22023';
  end if;
  perform public.learning_subject_lock(p_subject);
  insert into public.learning_consent_records(subject_id, purpose, granted, policy_version, capture_source, recorded_at, withdrawn_at)
  values (p_subject, 'personalization',       p_personalization,       p_policy_version, p_capture_source, v_now, case when p_personalization       then null else v_now end),
         (p_subject, 'aggregate_research',    p_aggregate_research,    p_policy_version, p_capture_source, v_now, case when p_aggregate_research    then null else v_now end),
         (p_subject, 'conversation_analysis', p_conversation_analysis, p_policy_version, p_capture_source, v_now, case when p_conversation_analysis then null else v_now end);
  -- Withdrawal propagation: past events stop being eligible for the purpose that was withdrawn.
  if not p_aggregate_research then
    update public.learning_events set aggregate_research_allowed = false where subject_id = p_subject and aggregate_research_allowed;
  end if;
  if not p_personalization then
    update public.learning_events set personalization_allowed = false where subject_id = p_subject and personalization_allowed;
  end if;
  if not p_conversation_analysis then
    update public.learning_events set conversation_analysis_allowed = false where subject_id = p_subject and conversation_analysis_allowed;
  end if;
  return query select * from public.learning_current_consent(p_subject);
end $$;

-- Validated shape comes from the API; consent is decided here, under the subject lock.
-- Returns: status in ('accepted','duplicate','consent_required','conversation_consent_required','event_id_conflict').
create or replace function public.learning_ingest_event(p_subject uuid, p_event jsonb)
returns table(status text, aggregate_eligible boolean, personalization_eligible boolean)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  c record; v_name text := p_event->>'event_name'; v_id uuid := (p_event->>'event_id')::uuid;
  v_owner uuid; v_question boolean := (p_event->>'event_name') = 'question_submitted';
begin
  if p_subject is null or v_id is null then raise exception 'invalid_learning_event' using errcode = '22023'; end if;
  perform public.learning_subject_lock(p_subject);
  select subject_id into v_owner from public.learning_events where event_id = v_id;
  if found then
    -- Idempotent replay for the same subject; never reveal or overwrite another subject's event.
    return query select case when v_owner = p_subject then 'duplicate' else 'event_id_conflict' end, false, false;
    return;
  end if;
  select * into c from public.learning_current_consent(p_subject);
  if v_question and not c.conversation_analysis then
    return query select 'conversation_consent_required', false, false; return;
  end if;
  if not (c.personalization or c.aggregate_research or (v_question and c.conversation_analysis)) then
    return query select 'consent_required', false, false; return;
  end if;
  insert into public.learning_events(event_id, subject_id, session_id, event_name, schema_version, occurred_at, app_version, platform,
    consent_policy_version, personalization_allowed, aggregate_research_allowed, conversation_analysis_allowed,
    beverage_category, feature, venue_region, source_type, properties)
  values (v_id, p_subject, nullif(p_event->>'session_id','')::uuid, v_name, (p_event->>'schema_version')::int,
    (p_event->>'occurred_at')::timestamptz, p_event->>'app_version', p_event->>'platform', c.policy_version,
    c.personalization, c.aggregate_research, c.conversation_analysis,
    p_event->>'beverage_category', p_event->>'feature', p_event->>'venue_region', p_event->>'source_type',
    coalesce(p_event->'properties', '{}'::jsonb));
  return query select 'accepted', c.aggregate_research, c.personalization;
end $$;

revoke all on function public.learning_subject_lock(uuid) from public, anon, authenticated;
revoke all on function public.learning_current_consent(uuid) from public, anon, authenticated;
revoke all on function public.learning_set_consent(uuid, text, boolean, boolean, boolean, text) from public, anon, authenticated;
revoke all on function public.learning_ingest_event(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.learning_current_consent(uuid) to service_role;
grant execute on function public.learning_set_consent(uuid, text, boolean, boolean, boolean, text) to service_role;
grant execute on function public.learning_ingest_event(uuid, jsonb) to service_role;