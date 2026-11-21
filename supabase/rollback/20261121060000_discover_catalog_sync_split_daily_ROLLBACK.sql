-- Rollback for FIX-011 timed-job split: remove the four separate calls and restore the single 06:10 UTC
-- "daily" call exactly as it was live on 21 Nov 2026 (job discover-catalog-sync-daily).
do $$
declare j text;
begin
  foreach j in array array['discover-catalog-sync-products-daily','discover-catalog-sync-profiles-daily',
                           'discover-catalog-sync-link-daily','discover-catalog-sync-facts-daily'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;

select cron.schedule('discover-catalog-sync-daily', '10 6 * * *', $c$
  select net.http_post(url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-catalog-sync',
    headers := jsonb_build_object('content-type','application/json','x-discover-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='discover_cron_secret')),
    body := '{"action":"daily"}'::jsonb, timeout_milliseconds := 115000) $c$);
