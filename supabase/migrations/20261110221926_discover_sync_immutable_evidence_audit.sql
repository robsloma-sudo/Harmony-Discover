create or replace function harmony_sync.prevent_staged_candidate_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, harmony_sync
as $$
begin
  if row(
    new.contract_version, new.source_system, new.source_project_ref,
    new.source_table, new.source_record_id, new.source_version,
    new.entity_type, new.canonical_key, new.payload, new.evidence,
    new.evidence_state, new.confidence, new.permission_basis,
    new.permission_reference, new.payload_hash, new.idempotency_key
  ) is distinct from row(
    old.contract_version, old.source_system, old.source_project_ref,
    old.source_table, old.source_record_id, old.source_version,
    old.entity_type, old.canonical_key, old.payload, old.evidence,
    old.evidence_state, old.confidence, old.permission_basis,
    old.permission_reference, old.payload_hash, old.idempotency_key
  ) then
    raise exception 'staged evidence and permission provenance are immutable';
  end if;
  return new;
end;
$$;
revoke all on function harmony_sync.prevent_staged_candidate_evidence_mutation() from public, anon, authenticated;
grant execute on function harmony_sync.prevent_staged_candidate_evidence_mutation() to service_role;
drop trigger if exists staged_candidates_evidence_immutable on harmony_sync.staged_candidates;
create trigger staged_candidates_evidence_immutable
before update on harmony_sync.staged_candidates
for each row execute function harmony_sync.prevent_staged_candidate_evidence_mutation();
revoke update, delete on harmony_sync.review_events from public, anon, authenticated, service_role;
grant select, insert on harmony_sync.review_events to service_role;
