-- P-20261123-0711 part 3b · Discover DEV (lqqmwqrffelgnbngrkep) only.
-- Turns on the weekly push of combined tap/change counts from Discover to PHG main with no person typing a password.
--   1. vault entry 'discover_explore_worker_secret': random, made inside the database, never printed, logged or typed.
--   2. discover_check_explore_worker_secret(text): server role only; discover-explore v0.3.0 asks it whether a given value matches.
--   3. pg_cron job 'discover-explore-weekly-counts': Mondays 03:17 UTC, reads the secret from the vault at call time.
-- Go-live order: after PR #128 is fully live AND discover-explore v0.3.0 (this PR) is deployed.
-- Privacy rules are unchanged (they live in discover_explore_weekly_export + the program): consent-only, groups of >= 5 guests.
-- Undo: supabase/rollback/20261125120000_discover_explore_weekly_counts_job_ROLLBACK.sql

-- 1. The worker secret. Created once; re-running this file keeps the existing value.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'discover_explore_worker_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'discover_explore_worker_secret',
      'discover-explore weekly push_counts job: shared between pg_cron and the program (P-20261123-0711 part 3b)');
  end if;
end $$;

-- 2. The check. Compares SHA-256 digests so the comparison does not leak how much of a guess was right.
create or replace function public.discover_check_explore_worker_secret(p_given text)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select coalesce(
    length(p_given) between 32 and 512
    and extensions.digest(p_given, 'sha256') = (
      select extensions.digest(s.decrypted_secret, 'sha256')
      from vault.decrypted_secrets s where s.name = 'discover_explore_worker_secret'),
    false);
$function$;
revoke all on function public.discover_check_explore_worker_secret(text) from public, anon, authenticated;
grant execute on function public.discover_check_explore_worker_secret(text) to service_role;

-- 3. The weekly job (cron.schedule with an existing name updates it, so this is safe to re-run).
select cron.schedule('discover-explore-weekly-counts', '17 3 * * 1', $job$
  select net.http_post(
    url := 'https://lqqmwqrffelgnbngrkep.supabase.co/functions/v1/discover-explore',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'discover_explore_worker_secret')),
    body := '{"action":"push_counts"}'::jsonb,
    timeout_milliseconds := 115000) $job$);
