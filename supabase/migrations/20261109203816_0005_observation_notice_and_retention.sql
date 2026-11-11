-- DEVELOPMENT ONLY. Apply ONLY to the separate Harmony Discover DEV project, after 0001-0004.
-- Phase 1/2 (handoff §10.4, §10.8; owner decisions 9 Nov 2026).
--
-- 1. Operational processing is not consent. Reading a menu photo the user just sent is the service they asked
--    for; we record which processing notice they were shown. Whether anything feeds aggregate learning is decided
--    only by the learning permissions (0004), never by a per-upload checkbox. The old columns stay for history
--    but are no longer required or written.
-- 2. Menu photo retention: an original photo is deleted once it was read well enough, its structured menu is
--    saved with the venue confirmed, and either a newer good photo of the same venue replaces it or the cap passes.
--    Mirrors packages/learning-engine/photo-retention.ts; both are tested against the same cases.

alter table public.menu_observations alter column consent_to_processing drop not null;
alter table public.menu_observations add column if not exists processing_notice_version text;
comment on column public.menu_observations.consent_to_processing is 'DEPRECATED (0005): replaced by processing_notice_version';
comment on column public.menu_observations.consent_to_contribute is 'DEPRECATED (0005): aggregate use is governed by learning consent (0004)';

alter table public.menu_observations
  add column if not exists venue_id uuid,
  add column if not exists venue_confirmed boolean not null default false,
  add column if not exists all_pages_complete boolean not null default false,
  add column if not exists min_ocr_confidence numeric(4,3) check (min_ocr_confidence between 0 and 1),
  add column if not exists unresolved_flags integer not null default 0 check (unresolved_flags >= 0),
  add column if not exists disputed boolean not null default false,
  add column if not exists structured_menu_saved boolean not null default false,
  add column if not exists qualified_at timestamptz;
create index if not exists menu_observations_venue_captured_idx on public.menu_observations(venue_id, captured_at);

alter table public.observation_assets add column if not exists deleted_at timestamptz;
alter table public.observation_assets add column if not exists deletion_reason text
  check (deletion_reason in ('superseded','cap_reached','user_request','account_deleted'));

create or replace function public.discover_observation_qualifies(o public.menu_observations, p_min_confidence numeric default 0.9)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select o.all_pages_complete and coalesce(o.min_ocr_confidence, 0) >= p_min_confidence and o.unresolved_flags = 0
     and not o.disputed and o.structured_menu_saved and o.venue_confirmed and o.venue_id is not null;
$$;

-- Assets whose original photo may now be deleted, with the reason. Read-only; the worker does the deleting.
create or replace function public.discover_photos_due_for_deletion(p_cap_days integer, p_now timestamptz default now(), p_limit integer default 200)
returns table(asset_id uuid, observation_id uuid, object_path text, derived_paths text[], reason text, superseded_by uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  with q as (
    select o.*, (select s.id from public.menu_observations s
                  where s.venue_id = o.venue_id and s.id <> o.id and s.captured_at > o.captured_at
                    and public.discover_observation_qualifies(s)
                  order by s.captured_at, s.id limit 1) as successor
    from public.menu_observations o
    where public.discover_observation_qualifies(o)
  ), due as (
    select q.id, case when q.successor is not null then 'superseded' else 'cap_reached' end as reason, q.successor
    from q
    where q.successor is not null or p_now >= coalesce(q.qualified_at, q.captured_at) + make_interval(days => p_cap_days)
  )
  select a.id, a.observation_id, a.object_path,
         coalesce(array(select e.normalized_object_path from public.observation_extractions e
                        where e.asset_id = a.id and e.normalized_object_path is not null), '{}'),
         due.reason, due.successor
  from due join public.observation_assets a on a.observation_id = due.id
  where a.deleted_at is null
  order by a.created_at
  limit p_limit;
$$;

-- Called by the worker only after the storage objects are gone. Idempotent.
create or replace function public.discover_mark_photo_deleted(p_asset uuid, p_reason text)
returns void language sql volatile security definer set search_path = public, pg_temp as $$
  update public.observation_assets set deleted_at = coalesce(deleted_at, now()), deletion_reason = coalesce(deletion_reason, p_reason),
         processing_status = 'deleted'
  where id = p_asset;
  update public.observation_extractions set normalized_object_path = null where asset_id = p_asset;
$$;

revoke all on function public.discover_observation_qualifies(public.menu_observations, numeric) from public, anon, authenticated;
revoke all on function public.discover_photos_due_for_deletion(integer, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.discover_mark_photo_deleted(uuid, text) from public, anon, authenticated;
grant execute on function public.discover_photos_due_for_deletion(integer, timestamptz, integer) to service_role;
grant execute on function public.discover_mark_photo_deleted(uuid, text) to service_role;