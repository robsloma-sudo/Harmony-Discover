-- ROLLBACK for supabase/migrations/20261121180000_discover_retire_photo_check_queue.sql (Discover DEV only).
-- Puts the 3 jobs closed on rollout back to 'queued' exactly as they were, removes the daily timed job and
-- the helper, and removes the 'job_expired' events it wrote. Photos and scans were never changed.
select cron.unschedule('discover-expire-photo-checks-daily')
where exists (select 1 from cron.job where jobname = 'discover-expire-photo-checks-daily');

update public.observation_jobs
set status = 'queued', attempts = 0, locked_at = null, locked_by = null, last_error = null,
    available_at = created_at, updated_at = now()
where id in ('d42a835e-568f-4a4a-a595-270d111f063c',
             'f71b4047-665d-4d93-a04a-82532b8b12c7',
             'f772cc45-e19a-48f3-bb2e-43afcb6e2e45')
  and status = 'failed' and last_error like 'expired: photo-check worker retired%';

delete from public.observation_processing_events
where event_type = 'job_expired' and detail->>'reason' = 'photo_check_worker_retired';

drop function if exists public.discover_expire_photo_checks();
