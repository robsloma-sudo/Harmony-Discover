-- Tighten review decision validation and require a ledger row before recording a review.
create or replace function harmony_sync.record_candidate_review(
  p_candidate_id uuid,
  p_decision text,
  p_reviewer_label text,
  p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, harmony_sync
as $$
declare
  v_candidate harmony_sync.staged_candidates%rowtype;
  v_event_type text;
begin
  if p_decision is null or p_decision not in ('approved','rejected','conflict','withdrawn') then
    raise exception 'unsupported review decision';
  end if;
  if p_candidate_id is null then raise exception 'candidate ID is required'; end if;
  if p_reviewer_label is null or char_length(trim(p_reviewer_label)) not between 1 and 120 then
    raise exception 'reviewer label is required (1-120 characters)';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 1 and 2000 then
    raise exception 'review reason is required (1-2000 characters)';
  end if;

  select * into v_candidate from harmony_sync.staged_candidates
  where id = p_candidate_id for update;
  if not found then raise exception 'staged candidate not found'; end if;
  if v_candidate.review_status <> 'pending' then raise exception 'candidate is not pending review'; end if;
  if not exists (select 1 from harmony_sync.sync_ledger l where l.staged_candidate_id = p_candidate_id) then
    raise exception 'candidate sync ledger row is missing';
  end if;

  v_event_type := case when p_decision = 'conflict' then 'conflict_opened'
    when p_decision = 'withdrawn' then 'withdrawn' else p_decision end;

  update harmony_sync.staged_candidates
  set review_status = p_decision, review_reason = trim(p_reason),
      reviewed_by = trim(p_reviewer_label), reviewed_at = now(), updated_at = now()
  where id = p_candidate_id;

  insert into harmony_sync.review_events (
    staged_candidate_id,event_type,prior_status,new_status,actor_label,reason,payload_hash,contract_version
  ) values (
    p_candidate_id,v_event_type,'pending',p_decision,trim(p_reviewer_label),
    trim(p_reason),v_candidate.payload_hash,v_candidate.contract_version
  );

  -- Review approval is not production promotion authorization.
  update harmony_sync.sync_ledger set status = 'blocked', updated_at = now()
  where staged_candidate_id = p_candidate_id;
  return p_candidate_id;
end;
$$;
revoke all on function harmony_sync.record_candidate_review(uuid,text,text,text) from public, anon, authenticated;
grant execute on function harmony_sync.record_candidate_review(uuid,text,text,text) to service_role;
