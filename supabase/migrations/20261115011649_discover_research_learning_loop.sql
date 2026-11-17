-- Harmony Discover DEV: research learning loop (OBSERVE -> RECORD -> EVALUATE -> LEARN -> PROPOSE -> TEST -> PROMOTE).
-- Research passes record what they found; views show per drink type which facts get found and which sites back them;
-- a function proposes hints from that data; only hints a person promotes are used by research.

create table if not exists public.discover_research_outcomes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  discover_product_id uuid,
  category text not null,
  field text not null,
  outcome text not null check (outcome in ('kept','dropped','not_returned')),
  reason text,
  confidence numeric,
  source_host text,
  source_kind text,
  research_kind text,
  model_version text
);
create index if not exists discover_research_outcomes_cat_idx on public.discover_research_outcomes (category, field);
alter table public.discover_research_outcomes enable row level security;

create or replace view public.discover_research_playbook_fields with (security_invoker = true) as
select category, field,
  count(*) as attempts,
  count(*) filter (where outcome = 'kept') as kept,
  round(count(*) filter (where outcome = 'kept')::numeric / nullif(count(*),0), 2) as hit_rate,
  count(distinct discover_product_id) as products
from public.discover_research_outcomes group by category, field;

create or replace view public.discover_research_playbook_sources with (security_invoker = true) as
select category, source_host,
  count(*) as facts_kept,
  count(distinct discover_product_id) as products,
  count(distinct field) as fields,
  round(avg(confidence), 2) as avg_confidence
from public.discover_research_outcomes
where outcome = 'kept' and source_host is not null
group by category, source_host;

create table if not exists public.discover_research_hints (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  category text not null,
  kind text not null check (kind in ('source_host','look_for','skip_field')),
  value text not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'proposed' check (status in ('proposed','promoted','rejected')),
  decided_by text,
  decided_at timestamptz,
  unique (category, kind, value)
);
alter table public.discover_research_hints enable row level security;

create or replace function public.discover_propose_research_hints()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; c integer;
begin
  insert into discover_research_hints (category, kind, value, evidence)
  select category, 'source_host', source_host, jsonb_build_object('facts_kept', facts_kept, 'products', products, 'fields', fields, 'avg_confidence', avg_confidence)
  from discover_research_playbook_sources where products >= 3
  on conflict (category, kind, value) do update set evidence = excluded.evidence
    where discover_research_hints.status = 'proposed';
  get diagnostics c = row_count; n := n + c;
  insert into discover_research_hints (category, kind, value, evidence)
  select category, 'skip_field', field, jsonb_build_object('attempts', attempts, 'kept', kept, 'hit_rate', hit_rate, 'products', products)
  from discover_research_playbook_fields where products >= 10 and hit_rate < 0.10
  on conflict (category, kind, value) do update set evidence = excluded.evidence
    where discover_research_hints.status = 'proposed';
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
revoke all on function public.discover_propose_research_hints() from public, anon, authenticated;
