-- FIX-011 (21 Nov 2026): split the nightly catalogue sync into four separate timed calls.
-- Before: one call at 06:10 UTC ran products + brand profiles + link + facts push on ONE shared 100 s clock;
-- a slow or stuck step starved the later ones and any Harmony error stopped the whole run.
-- After: each step is its own call with its own 100 s budget, 5-10 minutes apart, in the same order.
-- The "daily" action still exists in the server program for manual runs. The secret is read from the vault by
-- name at run time, exactly as before; no secret value is stored here.
-- Rollback: supabase/rollback/20261121060000_discover_catalog_sync_split_daily_ROLLBACK.sql

do $$ begin
  if exists (select 1 from cron.job where jobname = 'discover-catalog-sync-daily') then
    perform cron.unschedule('discover-catalog-sync-daily');
  end if;
end $$;

select cron.schedule('discover-catalog-sync-products-daily', '10 6 * * *', $c$
  select net.http_post(url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-catalog-sync',
    headers := jsonb_build_object('content-type','application/json','x-discover-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='discover_cron_secret')),
    body := '{"action":"products"}'::jsonb, timeout_milliseconds := 115000) $c$);

select cron.schedule('discover-catalog-sync-profiles-daily', '20 6 * * *', $c$
  select net.http_post(url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-catalog-sync',
    headers := jsonb_build_object('content-type','application/json','x-discover-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='discover_cron_secret')),
    body := '{"action":"brand_profiles"}'::jsonb, timeout_milliseconds := 115000) $c$);

select cron.schedule('discover-catalog-sync-link-daily', '25 6 * * *', $c$
  select net.http_post(url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-catalog-sync',
    headers := jsonb_build_object('content-type','application/json','x-discover-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='discover_cron_secret')),
    body := '{"action":"link"}'::jsonb, timeout_milliseconds := 115000) $c$);

select cron.schedule('discover-catalog-sync-facts-daily', '30 6 * * *', $c$
  select net.http_post(url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-catalog-sync',
    headers := jsonb_build_object('content-type','application/json','x-discover-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='discover_cron_secret')),
    body := '{"action":"facts_push"}'::jsonb, timeout_milliseconds := 115000) $c$);
