-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261115021740 "discover_product_lines_and_merge" was applied live but was never committed to the repo.

-- One shared record per real bottle: products know their line (brand + line), duplicates can be merged
-- (every fact, source, sighting and search count kept; each merge logged with a snapshot so it can be undone).
alter table public.discover_products add column if not exists discover_line_id uuid references public.discover_brand_lines(id) on delete set null;
create index if not exists discover_products_line_idx on public.discover_products (discover_line_id);

-- Which known line a brand + product name belongs to (longest matching line name or alias wins).
create or replace function public.discover_match_line(p_brand text, p_product text)
returns uuid language sql stable set search_path = public as $$
  with b as (select ' ' || discover_norm(p_brand) || ' ' as nb, ' ' || discover_norm(coalesce(p_product, '')) || ' ' as np),
  lines as (
    select l.id, n.name
    from discover_brand_lines l, b,
         lateral (select discover_norm(x) as name from unnest(array[l.line_name] || coalesce(l.line_aliases, '{}')) x) n
    where exists (select 1 from unnest(array[l.brand_name] || coalesce(l.brand_aliases, '{}')) a
                  where length(discover_norm(a)) > 0 and b.nb like '% ' || discover_norm(a) || ' %')
      and length(n.name) > 0 and b.np like '% ' || n.name || ' %'
  )
  select id from lines order by length(name) desc limit 1;
$$;

create or replace function public.discover_products_set_line() returns trigger language plpgsql set search_path = public as $$
begin
  if new.discover_line_id is null then new.discover_line_id := discover_match_line(new.brand_name, new.product_name); end if;
  return new;
end $$;
drop trigger if exists discover_products_set_line on public.discover_products;
create trigger discover_products_set_line before insert or update of brand_name, product_name on public.discover_products
  for each row execute function public.discover_products_set_line();

create table if not exists public.discover_product_merges (
  id bigint generated always as identity primary key,
  merged_at timestamptz not null default now(),
  from_product_id uuid not null,
  into_product_id uuid not null,
  reason text,
  snapshot jsonb not null       -- the removed product row and its attributes, for undo
);
alter table public.discover_product_merges enable row level security;   -- service role only

create or replace function public.discover_merge_product(p_from uuid, p_into uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if p_from = p_into then return; end if;
  insert into discover_product_merges(from_product_id, into_product_id, reason, snapshot)
  select p_from, p_into, p_reason, jsonb_build_object('product', to_jsonb(p),
    'attributes', coalesce((select jsonb_agg(to_jsonb(x)) from discover_product_attributes x where x.discover_product_id = p_from), '[]'::jsonb))
  from discover_products p where p.id = p_from;
  if not found then return; end if;

  update discover_product_evidence set discover_product_id = p_into where discover_product_id = p_from;
  -- Facts: keep the more confident value for each kind of fact.
  for a in select * from discover_product_attributes where discover_product_id = p_from loop
    if exists (select 1 from discover_product_attributes t where t.discover_product_id = p_into and t.attribute_code = a.attribute_code) then
      update discover_product_attributes t set value_text = a.value_text, value_numeric = a.value_numeric, value_json = a.value_json,
             unit = a.unit, state = a.state, confidence = a.confidence, evidence_id = a.evidence_id, updated_at = now()
       where t.discover_product_id = p_into and t.attribute_code = a.attribute_code
         and coalesce(a.confidence, 0) > coalesce(t.confidence, 0);
      delete from discover_product_attributes where id = a.id;
    else
      update discover_product_attributes set discover_product_id = p_into where id = a.id;
    end if;
  end loop;
  update discover_product_packages set discover_product_id = p_into where discover_product_id = p_from;
  update bottle_sightings set discover_product_id = p_into where discover_product_id = p_from;
  update discover_phg_export_queue set discover_product_id = p_into where discover_product_id = p_from;
  delete from discover_enrichment_jobs j where j.discover_product_id = p_from and j.status in ('queued','processing','retry')
    and exists (select 1 from discover_enrichment_jobs k where k.discover_product_id = p_into and k.job_type = j.job_type and k.status in ('queued','processing','retry'));
  update discover_enrichment_jobs set discover_product_id = p_into where discover_product_id = p_from;
  insert into discover_product_search_usage (discover_product_id, searches, research_runs, last_research_at)
  select p_into, searches, research_runs, last_research_at from discover_product_search_usage where discover_product_id = p_from
  on conflict (discover_product_id) do update set searches = discover_product_search_usage.searches + excluded.searches,
    research_runs = discover_product_search_usage.research_runs + excluded.research_runs,
    last_research_at = greatest(discover_product_search_usage.last_research_at, excluded.last_research_at);
  update discover_research_outcomes set discover_product_id = p_into where discover_product_id = p_from;
  update discover_products t set first_seen_at = least(t.first_seen_at, f.first_seen_at), last_seen_at = greatest(t.last_seen_at, f.last_seen_at),
         upc_gtin = coalesce(t.upc_gtin, f.upc_gtin), ean = coalesce(t.ean, f.ean), updated_at = now()
    from discover_products f where t.id = p_into and f.id = p_from;
  delete from discover_products where id = p_from;
end $$;
revoke all on function public.discover_merge_product(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.discover_match_line(text, text) from public, anon;

-- Products learn their line.
update public.discover_products set discover_line_id = public.discover_match_line(brand_name, product_name) where discover_line_id is null;
