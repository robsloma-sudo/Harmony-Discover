-- Marty Sullivan Boston v1.0 — Discover DEV only.
-- No migration has been applied by this source commit.
create table if not exists public.bartender_voice_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  voice_enabled boolean not null default false,
  memory_enabled boolean not null default false,
  voice_consent_version text,
  memory_consent_version text,
  voice_granted_at timestamptz,
  memory_granted_at timestamptz,
  voice_withdrawn_at timestamptz,
  memory_withdrawn_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.bartender_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('taste_preference','drink_history','interaction_style')),
  label text not null check (char_length(label) between 1 and 80),
  value text not null check (char_length(value) between 1 and 500),
  source text not null default 'user_confirmed' check (source = 'user_confirmed'),
  consent_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, category, label)
);

create table if not exists public.bartender_comedy_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scenario_id text not null,
  scenario_version text not null,
  guest_prompt text not null check (char_length(guest_prompt) between 1 and 1000),
  bartender_response text not null check (char_length(bartender_response) between 1 and 3000),
  reviewer_notes text not null default '' check (char_length(reviewer_notes) <= 2000),
  specificity smallint not null check (specificity between 1 and 5),
  originality smallint not null check (originality between 1 and 5),
  timing smallint not null check (timing between 1 and 5),
  natural_delivery smallint not null check (natural_delivery between 1 and 5),
  character_consistency smallint not null check (character_consistency between 1 and 5),
  restraint smallint not null check (restraint between 1 and 5),
  rubric_version integer not null default 1,
  created_at timestamptz not null default now()
);

alter table public.bartender_voice_consents enable row level security;
alter table public.bartender_memories enable row level security;
alter table public.bartender_comedy_evaluations enable row level security;

create policy "bartender consent owner read" on public.bartender_voice_consents
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "bartender consent owner insert" on public.bartender_voice_consents
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "bartender consent owner update" on public.bartender_voice_consents
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "bartender memory owner read with consent" on public.bartender_memories
  for select to authenticated using (
    (select auth.uid()) = user_id and exists (
      select 1 from public.bartender_voice_consents c
      where c.user_id = (select auth.uid())
        and c.memory_enabled = true and c.memory_withdrawn_at is null
    )
  );
create policy "bartender memory owner insert with consent" on public.bartender_memories
  for insert to authenticated with check (
    (select auth.uid()) = user_id and exists (
      select 1 from public.bartender_voice_consents c
      where c.user_id = (select auth.uid())
        and c.memory_enabled = true and c.memory_withdrawn_at is null
    )
  );
create policy "bartender memory owner update with consent" on public.bartender_memories
  for update to authenticated using (
    (select auth.uid()) = user_id and exists (
      select 1 from public.bartender_voice_consents c
      where c.user_id = (select auth.uid())
        and c.memory_enabled = true and c.memory_withdrawn_at is null
    )
  ) with check (
    (select auth.uid()) = user_id and exists (
      select 1 from public.bartender_voice_consents c
      where c.user_id = (select auth.uid())
        and c.memory_enabled = true and c.memory_withdrawn_at is null
    )
  );
-- Deletion remains possible after consent withdrawal.
create policy "bartender memory owner delete" on public.bartender_memories
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "bartender comedy evaluation owner read" on public.bartender_comedy_evaluations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "bartender comedy evaluation owner insert" on public.bartender_comedy_evaluations
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "bartender comedy evaluation owner delete" on public.bartender_comedy_evaluations
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Supabase's Data API no longer auto-exposes new public tables by default.
grant select, insert, update on public.bartender_voice_consents to authenticated;
grant select, insert, update, delete on public.bartender_memories to authenticated;
grant select, insert, delete on public.bartender_comedy_evaluations to authenticated;

-- Service-role-only atomic per-user rate limiter for Realtime session grants.
create table if not exists public.marty_voice_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0)
);
alter table public.marty_voice_rate_limits enable row level security;

create or replace function public.consume_marty_voice_rate_limit(
  p_user_id uuid,
  p_window_start timestamptz,
  p_limit integer default 8
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare v_hits integer;
begin
  insert into public.marty_voice_rate_limits(user_id, window_start, hits)
  values (p_user_id, p_window_start, 1)
  on conflict (user_id) do update
    set window_start = case
      when public.marty_voice_rate_limits.window_start < excluded.window_start then excluded.window_start
      else public.marty_voice_rate_limits.window_start
    end,
    hits = case
      when public.marty_voice_rate_limits.window_start < excluded.window_start then 1
      else public.marty_voice_rate_limits.hits + 1
    end
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;
revoke all on function public.consume_marty_voice_rate_limit(uuid,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.consume_marty_voice_rate_limit(uuid,timestamptz,integer) to service_role;
grant insert, update, select on public.marty_voice_rate_limits to service_role;
