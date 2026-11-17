-- Running total of web searches spent on each product (shown at the top of its card; counted from 15 Nov 2026).
create table if not exists public.discover_product_search_usage (
  discover_product_id uuid primary key references public.discover_products(id) on delete cascade,
  searches integer not null default 0,
  research_runs integer not null default 0,
  last_research_at timestamptz
);
alter table public.discover_product_search_usage enable row level security;

create or replace function public.discover_add_product_searches(p_product uuid, p_searches integer)
returns integer language sql security definer set search_path = public as $$
  insert into discover_product_search_usage (discover_product_id, searches, research_runs, last_research_at)
  values (p_product, greatest(0, least(p_searches, 50)), 1, now())
  on conflict (discover_product_id) do update
    set searches = discover_product_search_usage.searches + greatest(0, least(p_searches, 50)),
        research_runs = discover_product_search_usage.research_runs + 1,
        last_research_at = now()
  returning searches;
$$;
revoke all on function public.discover_add_product_searches(uuid, integer) from public, anon, authenticated;
