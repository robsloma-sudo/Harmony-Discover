-- DEVELOPMENT ONLY. Discover DEV project, after 0001-0008.
-- 1. Shared per-subject rate limit for stateless Edge Functions (fixed window, atomic upsert).
-- 2. The daily retention job's secret: generated inside the database, stored in Supabase Vault, checked here.
--    It never leaves the database: pg_cron reads it to call the function, the function asks the database to check it.

create table if not exists public.discover_rate_limits (
  subject_id uuid not null, bucket text not null, window_start timestamptz not null, hits integer not null default 0,
  primary key (subject_id, bucket)
);
alter table public.discover_rate_limits enable row level security;   -- server-only; no client policies

create or replace function public.discover_rate_limit(p_subject uuid, p_bucket text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_now timestamptz := clock_timestamp(); v_hits integer;
begin
  if p_subject is null or p_max < 1 or p_window_seconds < 1 then return false; end if;
  insert into public.discover_rate_limits as r (subject_id, bucket, window_start, hits) values (p_subject, p_bucket, v_now, 1)
  on conflict (subject_id, bucket) do update set
    hits = case when r.window_start <= v_now - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start <= v_now - make_interval(secs => p_window_seconds) then v_now else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

-- Generate the cron secret once (two random UUIDs hashed; never printed, never in a migration file).
do $$ begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'discover_cron_secret') then
    perform vault.create_secret(encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex'),
                                'discover_cron_secret', 'Discover daily retention job: shared between pg_cron and discover-retention');
  end if;
end $$;

create or replace function public.discover_check_cron_secret(p_given text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(length(p_given) >= 32 and p_given = (select decrypted_secret from vault.decrypted_secrets where name = 'discover_cron_secret'), false);
$$;

-- Rate-limit rows are only useful for the current window; old ones are swept by the daily job.
create or replace function public.discover_purge_rate_limits(p_older_than_seconds integer default 86400) returns integer
language sql volatile security definer set search_path = public, pg_temp as $$
  with d as (delete from public.discover_rate_limits where window_start < clock_timestamp() - make_interval(secs => p_older_than_seconds) returning 1)
  select count(*)::int from d;
$$;

revoke all on function public.discover_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.discover_check_cron_secret(text) from public, anon, authenticated;
revoke all on function public.discover_purge_rate_limits(integer) from public, anon, authenticated;
grant execute on function public.discover_rate_limit(uuid, text, integer, integer) to service_role;
grant execute on function public.discover_check_cron_secret(text) to service_role;
grant execute on function public.discover_purge_rate_limits(integer) to service_role;