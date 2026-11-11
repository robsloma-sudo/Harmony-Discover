-- DEVELOPMENT ONLY. Discover DEV project, after 0001-0006. Phase 2 (handoff §10.8): export and account deletion.
-- Order used by the API for deletion: (1) open a deletion request, (2) remove every stored photo and derived copy,
-- (3) delete all database rows for the subject (this function), (4) delete the auth user, (5) close the request.
-- Each step is idempotent, so a failed deletion is safely retried from the start.
-- The deletion receipt keeps only a SHA-256 of the subject id, timestamps and counts: no personal data.

create table if not exists public.learning_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  subject_hash text not null,
  status text not null default 'started' check (status in ('started','storage_removed','data_deleted','completed','failed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  storage_objects_removed integer not null default 0,
  rows_deleted jsonb not null default '{}'::jsonb,
  last_error text
);
create index if not exists learning_deletion_requests_subject_idx on public.learning_deletion_requests(subject_hash, requested_at desc);
alter table public.learning_deletion_requests enable row level security;   -- server-only; no client policies

create or replace function public.discover_subject_hash(p_subject uuid) returns text
language sql immutable set search_path = public, pg_temp as $$ select encode(sha256(convert_to(p_subject::text, 'UTF8')), 'hex') $$;

-- Every storage object belonging to the subject that may still exist (originals and derived copies).
create or replace function public.discover_subject_storage_paths(p_subject uuid) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct p) filter (where p is not null), '{}') from (
    select a.object_path as p from public.observation_assets a where a.consumer_id = p_subject and a.deleted_at is null
    union all
    select e.normalized_object_path from public.observation_extractions e
      join public.observation_assets a on a.id = e.asset_id where a.consumer_id = p_subject
  ) x;
$$;

-- Everything Discover holds about the subject, as JSON. Photos are listed by path; their bytes are not embedded.
create or replace function public.discover_export_subject(p_subject uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'export_version', 1,
    'generated_at', now(),
    'consent_current', (select to_jsonb(c) from public.learning_current_consent(p_subject) c),
    'consent_history', coalesce((select jsonb_agg(jsonb_build_object('purpose', purpose, 'granted', granted, 'policy_version', policy_version,
        'recorded_at', recorded_at, 'withdrawn_at', withdrawn_at) order by seq) from public.learning_consent_records where subject_id = p_subject), '[]'),
    'learning_events', coalesce((select jsonb_agg(to_jsonb(e) - 'id' - 'subject_id' order by e.occurred_at) from public.learning_events e where e.subject_id = p_subject), '[]'),
    'taste_profile', (select to_jsonb(t) - 'subject_id' from public.personal_taste_profiles t where t.subject_id = p_subject),
    'menu_observations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'status', o.status, 'captured_at', o.captured_at, 'venue_name_submitted', o.venue_name_submitted,
        'capture_source', o.capture_source, 'processing_notice_version', o.processing_notice_version,
        'photos', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'mime_type', a.mime_type, 'byte_size', a.byte_size,
            'stored', a.deleted_at is null, 'deleted_at', a.deleted_at, 'deletion_reason', a.deletion_reason) order by a.created_at)
          from public.observation_assets a where a.observation_id = o.id), '[]')
      ) order by o.captured_at) from public.menu_observations o where o.consumer_id = p_subject), '[]')
  );
$$;

create or replace function public.discover_start_deletion(p_subject uuid) returns uuid
language sql volatile security definer set search_path = public, pg_temp as $$
  insert into public.learning_deletion_requests(subject_hash) values (public.discover_subject_hash(p_subject)) returning id;
$$;

create or replace function public.discover_update_deletion(p_request uuid, p_status text, p_storage_removed integer default null,
                                                           p_rows jsonb default null, p_error text default null) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  update public.learning_deletion_requests set status = p_status,
    storage_objects_removed = coalesce(p_storage_removed, storage_objects_removed),
    rows_deleted = coalesce(p_rows, rows_deleted), last_error = p_error,
    completed_at = case when p_status = 'completed' then now() else completed_at end
  where id = p_request;
$$;

-- Deletes every database row for the subject, under the same lock as consent writes and event ingest,
-- so no event can be stored for the subject while (or after, within this transaction) it is being deleted.
create or replace function public.discover_delete_subject_data(p_subject uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n_events int; n_consent int; n_profiles int; n_observations int;
begin
  if p_subject is null then raise exception 'invalid_subject' using errcode = '22023'; end if;
  perform public.learning_subject_lock(p_subject);
  delete from public.learning_question_records where subject_id = p_subject;
  delete from public.learning_events where subject_id = p_subject;            get diagnostics n_events = row_count;
  delete from public.learning_consent_records where subject_id = p_subject;   get diagnostics n_consent = row_count;
  delete from public.personal_taste_profiles where subject_id = p_subject;    get diagnostics n_profiles = row_count;
  delete from public.menu_observations where consumer_id = p_subject;         get diagnostics n_observations = row_count;  -- cascades assets, jobs, extractions, processing events
  return jsonb_build_object('learning_events', n_events, 'consent_records', n_consent, 'taste_profiles', n_profiles, 'menu_observations', n_observations);
end $$;

revoke all on function public.discover_subject_hash(uuid) from public, anon, authenticated;
revoke all on function public.discover_subject_storage_paths(uuid) from public, anon, authenticated;
revoke all on function public.discover_export_subject(uuid) from public, anon, authenticated;
revoke all on function public.discover_start_deletion(uuid) from public, anon, authenticated;
revoke all on function public.discover_update_deletion(uuid, text, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.discover_delete_subject_data(uuid) from public, anon, authenticated;
grant execute on function public.discover_subject_storage_paths(uuid) to service_role;
grant execute on function public.discover_export_subject(uuid) to service_role;
grant execute on function public.discover_start_deletion(uuid) to service_role;
grant execute on function public.discover_update_deletion(uuid, text, integer, jsonb, text) to service_role;
grant execute on function public.discover_delete_subject_data(uuid) to service_role;