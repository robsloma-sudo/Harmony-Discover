-- DEVELOPMENT ONLY. Discover DEV project, after 0001-0007.
-- Raw learning event retention: 13 months (owner decision, Rob, 9 Nov 2026), so the same season can be compared
-- year over year. Age is measured from received_at (server clock), never the client-supplied occurred_at, so a
-- device cannot keep an event alive by post-dating it. Question records are removed with their event (cascade).
create index if not exists learning_events_received_idx on public.learning_events(received_at);

create or replace function public.discover_purge_learning_events(p_months integer default 13, p_now timestamptz default now(),
                                                                 p_batch integer default 5000)
returns integer language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if p_months is null or p_months < 1 then raise exception 'invalid_retention_months' using errcode = '22023'; end if;
  delete from public.learning_events where id in (
    select id from public.learning_events where received_at < p_now - make_interval(months => p_months)
    order by received_at limit p_batch);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.discover_purge_learning_events(integer, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.discover_purge_learning_events(integer, timestamptz, integer) to service_role;