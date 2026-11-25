-- ROLLBACK for 20261125120000_discover_explore_weekly_counts_job.sql (Discover DEV only).
-- Order: 1) redeploy discover-explore v0.2.0 (PR #128 source, git show b397fa6:supabase/functions/discover-explore/index.ts)
--           which checks the old DISCOVER_EXPLORE_WORKER_SECRET program setting again (unset = push_counts refused, safe);
--        2) run this file. Nothing already sent to PHG main is touched; the export log stays as it is.

do $$ begin
  if exists (select 1 from cron.job where jobname = 'discover-explore-weekly-counts') then
    perform cron.unschedule('discover-explore-weekly-counts');
  end if;
end $$;

drop function if exists public.discover_check_explore_worker_secret(text);

delete from vault.secrets where name = 'discover_explore_worker_secret';
