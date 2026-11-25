-- Discover DEV (lqqmwqrffelgnbngrkep) · kit S4-D5-002 · Retire the unhosted photo-check queue cleanly.
--
-- Why retire instead of adding a runner:
-- * The photo-check worker (apps/api/src/worker.ts) is a Node program that needs the "sharp" image library.
--   It was a development scaffold, has never been hosted, and cannot run inside Supabase Edge Functions or pg_cron.
-- * Nothing downstream waits for it. The live menu reader (discover-menu-read) reads the uploaded pages directly,
--   and the app already re-saves every page as a fresh JPEG on the phone before upload, which drops photo metadata.
-- * Hosting it would need a new always-on server (or a GitHub schedule holding the database master key): new cost
--   and a new secret for a step that has never run once.
--
-- What this does (no paid reading service is set up or called; no data is deleted):
-- 1) discover_expire_photo_checks(): marks 'validate_assets' jobs still waiting after 1 day as 'failed' with a
--    clear reason, and writes one 'job_expired' event per job. Photos, scans and their status are left as they are.
-- 2) Runs it once now, which closes the 3 jobs waiting since 11 Nov 2026.
-- 3) A daily timed job (09:53 UTC) keeps doing this, so the queue can never silently pile up again.
-- Rollback: supabase/rollback/20261121180000_discover_retire_photo_check_queue_ROLLBACK.sql

create or replace function public.discover_expire_photo_checks()
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_count integer;
begin
  with expired as (
    update public.observation_jobs j
    set status = 'failed',
        locked_at = null,
        locked_by = null,
        last_error = 'expired: photo-check worker retired (S4-D5-002); the menu reader reads pages directly',
        updated_at = now()
    where j.job_type = 'validate_assets'
      and (j.status in ('queued', 'retry')
           or (j.status = 'processing' and j.locked_at < now() - interval '1 day'))
      and j.created_at < now() - interval '1 day'
    returning j.id, j.observation_id, j.created_at
  ), logged as (
    insert into public.observation_processing_events (observation_id, asset_id, event_type, detail)
    select e.observation_id, null, 'job_expired',
           pg_catalog.jsonb_build_object('jobType', 'validate_assets', 'jobId', e.id,
                                         'queuedAt', e.created_at, 'reason', 'photo_check_worker_retired')
    from expired e
    returning 1
  )
  select pg_catalog.count(*)::integer into v_count from logged;
  return v_count;
end
$function$;

-- Same access rule as the other queue helpers: server side only.
revoke all on function public.discover_expire_photo_checks() from public, anon, authenticated;
grant execute on function public.discover_expire_photo_checks() to service_role;

comment on function public.discover_expire_photo_checks() is
  'S4-D5-002: closes validate_assets jobs older than 1 day (photo-check worker retired; never hosted). Daily via pg_cron.';

-- Close the jobs that are already stuck (3 on 21 Nov 2026, all queued 11 Nov).
select public.discover_expire_photo_checks();

-- Keep the queue clean from now on.
select cron.schedule('discover-expire-photo-checks-daily', '53 9 * * *',
  $c$ select public.discover_expire_photo_checks() $c$);
