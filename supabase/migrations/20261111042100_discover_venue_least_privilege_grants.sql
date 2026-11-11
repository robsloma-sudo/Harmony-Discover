-- Keep venue directory discovery public-read, but remove inherited broad table ACLs.
-- Rate-limit state and venue submissions must never be directly readable or mutable
-- by anonymous clients. RLS remains enabled and continues to enforce row ownership.

revoke all privileges on table public.discover_rate_limits from public, anon, authenticated;
revoke all privileges on table public.discover_venue_submissions from public, anon, authenticated;
revoke all privileges on table public.discover_venues from public, anon, authenticated;

grant select on table public.discover_venues to anon, authenticated;
grant insert on table public.discover_venue_submissions to authenticated;
