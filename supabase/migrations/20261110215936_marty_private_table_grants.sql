-- Tighten default PUBLIC privileges on private Marty data.
revoke all on table public.bartender_voice_consents, public.bartender_memories, public.bartender_comedy_evaluations from public, anon;
revoke all on table public.marty_voice_rate_limits from public, anon, authenticated;
grant select, insert, update on public.marty_voice_rate_limits to service_role;
