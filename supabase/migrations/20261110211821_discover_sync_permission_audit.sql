-- Tighten the isolated Discover DEV staging permission audit fields.
alter table harmony_sync.staged_candidates
  add column if not exists permission_reference text;
alter table harmony_sync.staged_candidates
  add constraint staged_candidates_permission_basis_check
  check (permission_basis in ('public_source_license','explicit_contribution_consent','operator_attested_permission'));
alter table harmony_sync.staged_candidates
  add constraint staged_candidates_permission_reference_check
  check (permission_reference is not null and char_length(trim(permission_reference)) between 1 and 500);
