-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116183921 "discover_phg_enrich_queue" was applied live but was never committed to the repo.
create table if not exists public.discover_phg_enrich_queue (
  phg_code text primary key,
  brand text not null,
  product_name text not null,
  product_class text,
  known_size_ml numeric,
  known_abv numeric,
  url text,
  tier text,
  batch text not null default 'pilot',
  status text not null default 'pending' check (status in ('pending','working','done','failed','skipped')),
  attempts int not null default 0,
  page_status int,
  page_chars int,
  result jsonb,
  searches int default 0,
  input_tokens int default 0,
  output_tokens int default 0,
  cost_usd numeric(10,5) default 0,
  error text,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.discover_phg_enrich_queue is 'Steps 3-4: Harmony research (product page + web search) for PHG unknown products not resolved by COLA. Results staged here; no PHG writes.';
alter table public.discover_phg_enrich_queue enable row level security;
revoke all on public.discover_phg_enrich_queue from anon, authenticated;

create or replace function public.discover_phg_enrich_claim(p_n int, p_batch text default null)
returns setof public.discover_phg_enrich_queue
language sql security definer set search_path = public as $$
  update public.discover_phg_enrich_queue q set status='working', attempts=attempts+1, claimed_at=now()
  where q.phg_code in (
    select phg_code from public.discover_phg_enrich_queue
    where (status='pending' or (status='working' and claimed_at < now() - interval '5 minutes' and attempts < 3))
      and (p_batch is null or batch = p_batch)
    order by created_at, phg_code limit greatest(1, least(p_n, 8)) for update skip locked)
  returning q.*;
$$;
revoke all on function public.discover_phg_enrich_claim(int, text) from public, anon, authenticated;
