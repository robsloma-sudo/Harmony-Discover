-- SUPABASE-ONLY (needs pg_cron, pg_net and Vault; skipped by the local test runner).
-- DEVELOPMENT ONLY. Discover DEV project, after 0009, and after the vault secret 'discover_retention_url' exists
-- (project-specific; created by supabase/setup/dev-project.sql, not in a migration).
-- Daily at 09:17 UTC (03:17 Chicago): call discover-retention, which applies Rob's rules (photos 90 days or superseded,
-- raw learning events 13 months). Old rate-limit rows are swept directly in the database.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname in ('discover-retention-daily', 'discover-rate-limit-sweep');

select cron.schedule('discover-retention-daily', '17 9 * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'discover_retention_url'),
    headers := jsonb_build_object('content-type', 'application/json',
                 'x-discover-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discover_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000)
$job$);

select cron.schedule('discover-rate-limit-sweep', '47 9 * * *', $job$ select public.discover_purge_rate_limits() $job$);