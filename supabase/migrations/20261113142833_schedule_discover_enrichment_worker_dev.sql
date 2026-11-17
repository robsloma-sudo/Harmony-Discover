-- DEV-only bounded enrichment worker invocation. Reuses the existing Vault-held Discover cron secret.
-- The worker independently validates the secret through discover_check_cron_secret().
do $migration$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'discover-enrichment-worker-minute';

  perform cron.schedule(
    'discover-enrichment-worker-minute',
    '* * * * *',
    $command$
      select net.http_post(
        url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-enrichment-worker',
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'x-discover-cron-secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'discover_cron_secret')
        ),
        body := '{"limit":5,"worker":"discover-cron"}'::jsonb,
        timeout_milliseconds := 120000
      );
    $command$
  );
end;
$migration$;
