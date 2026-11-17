-- Discover DEV (lqqmwqrffelgnbngrkep): pg_cron jobs that exist live but were created outside the migration log.
-- Snapshot of cron.job taken 2026-11-17. Reference / rebuild script, NOT a migration (re-running it on the live
-- project is harmless: cron.schedule with an existing job name updates that job).
-- No secrets here: every job reads the cron secret from Vault (name 'discover_cron_secret') at run time.
-- All other Discover cron jobs (retention, rate-limit sweep, enrichment worker, research hints, merge duplicates,
-- link-phg-30min, shape profiles) are created by files in supabase/migrations.

select cron.schedule('discover-catalog-sync-daily', '10 6 * * *', $job$
  select net.http_post(url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-catalog-sync',
    headers := jsonb_build_object('content-type','application/json','x-discover-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='discover_cron_secret')),
    body := '{"action":"daily"}'::jsonb, timeout_milliseconds := 115000) $job$);

select cron.schedule('discover-catalog-sync-labels-daily', '40 6 * * *', $job$
  update public.discover_bridge_config set value='0' where key='labels_done';
  select net.http_post(url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-catalog-sync',
    headers := jsonb_build_object('content-type','application/json','x-discover-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='discover_cron_secret')),
    body := '{"action":"labels"}'::jsonb, timeout_milliseconds := 115000) $job$);

select cron.schedule('discover-cola-details-10min', '*/10 * * * *', $job$
  select net.http_post(url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-catalog-sync',
    headers := jsonb_build_object('content-type','application/json','x-discover-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='discover_cron_secret')),
    body := '{"action":"cola_details"}'::jsonb, timeout_milliseconds := 115000)
  where exists (select 1 from public.discover_cola_detail_wanted w
                where w.sent_at is null
                   or (w.sent_at > now() - interval '6 hours' and not exists (select 1 from public.discover_cola_details c where c.ttb_id = w.ttb_id))) $job$);

select cron.schedule('discover-fonts-monthly', '15 8 1 * *', $job$
  select net.http_post(url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-catalog-sync',
    headers := jsonb_build_object('content-type','application/json','x-discover-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='discover_cron_secret')),
    body := '{"action":"fonts"}'::jsonb, timeout_milliseconds := 115000) $job$);

select cron.schedule('discover-letter-bags-weekly', '0 7 * * 0', $job$ set statement_timeout = '15min'; select public.discover_brand_bags_refresh(); $job$);

select cron.schedule('discover-letter-pack-weekly', '40 7 * * 0', $job$
  select net.http_post(url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-catalog-sync',
    headers := jsonb_build_object('content-type','application/json','x-discover-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='discover_cron_secret')),
    body := '{"action":"letter_pack"}'::jsonb, timeout_milliseconds := 115000) $job$);

select cron.schedule('discover-phg-enrich-push', '*/10 * * * *', $job$
  select net.http_post(url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-catalog-sync',
    headers := jsonb_build_object('content-type','application/json','x-discover-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='discover_cron_secret')),
    body := '{"action":"research_push"}'::jsonb, timeout_milliseconds := 115000)
  where exists (select 1 from public.discover_phg_enrich_queue where status='done' and pushed_at is null) $job$);

-- PHG research run: two parallel calls per minute while work is queued, stopping at $25 total spend.
select cron.schedule('discover-phg-enrich-run', '* * * * *', $job$
  select net.http_post(url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-phg-enrich',
    headers := jsonb_build_object('content-type','application/json','x-discover-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='discover_cron_secret')),
    body := '{"limit":6,"batch":"full"}'::jsonb, timeout_milliseconds := 140000)
  from generate_series(1,2)
  where (select coalesce(sum(cost_usd),0) from public.discover_phg_enrich_queue) < 25
    and exists (select 1 from public.discover_phg_enrich_queue where batch='full' and status in ('pending','working')) $job$);
