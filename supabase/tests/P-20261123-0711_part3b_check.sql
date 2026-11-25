-- Read-only checks for P-20261123-0711 part 3b (Discover DEV). Prints no secret.
select json_build_object(
  'secret_exists',      (select count(*) = 1 from vault.secrets where name = 'discover_explore_worker_secret'),
  'secret_length_ok',   (select length(decrypted_secret) = 64 from vault.decrypted_secrets where name = 'discover_explore_worker_secret'),
  'check_accepts_vault',(select public.discover_check_explore_worker_secret(decrypted_secret) from vault.decrypted_secrets where name = 'discover_explore_worker_secret'),
  'check_refuses_wrong',(select not public.discover_check_explore_worker_secret(repeat('x', 64))),
  'check_refuses_null', (select not public.discover_check_explore_worker_secret(null)),
  'check_grants',       (select proacl::text from pg_proc where proname = 'discover_check_explore_worker_secret'),
  'anon_can_call',      has_function_privilege('anon', 'public.discover_check_explore_worker_secret(text)', 'execute'),
  'authed_can_call',    has_function_privilege('authenticated', 'public.discover_check_explore_worker_secret(text)', 'execute'),
  'job',                (select jobname || ' | ' || schedule || ' | active=' || active from cron.job where jobname = 'discover-explore-weekly-counts'),
  'job_reads_vault',    (select command like '%vault.decrypted_secrets%discover_explore_worker_secret%' and command not like '%' || (select decrypted_secret from vault.decrypted_secrets where name='discover_explore_worker_secret') || '%' from cron.job where jobname = 'discover-explore-weekly-counts')
) as part3b_checks;
-- Expected: true, true, true, true, true, {postgres=X/postgres,service_role=X/postgres}, false, false,
--           'discover-explore-weekly-counts | 17 3 * * 1 | active=true', true.
-- Live program checks after deploy (pg_net, no secret printed):
--   wrong secret        -> 401 unauthorized
--   vault secret + {"action":"push_counts","dry_run":true} -> 200 dry_run:true, all_groups_at_least_min:true,
--     row_keys exactly [change_type,count,event,guests,item_kind,item_ref,venue_id,week_start]
