-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116220304 "discover_letter_lookup" was applied live but was never committed to the repo.

create index if not exists discover_bag_keys_key_idx on public.discover_bag_keys(key);
create or replace function public.discover_letter_lookup(p_words text[], p_limit int default 5)
returns table(brand text, score numeric, matched_words int, exact_hits int, labels int)
language sql stable security definer set search_path = public, extensions as $$
  with w as (select public.discover_bag(x) bag, i from unnest(p_words) with ordinality t(x, i) where length(public.discover_bag(x)) >= 3 and i <= 6),
  full_bag as (select public.discover_bag(array_to_string(p_words[1:2], '')) b1),
  probes as (
    select bag key, i, true q_exact from w
    union all select d, i, false from w, public.discover_bag_deletes(w.bag) d
    union all select b1, 0, true from full_bag where length(b1) >= 3
    union all select d, 0, false from full_bag, public.discover_bag_deletes(b1) d),
  hits as (
    select k.brand_norm, p.i, bool_or(k.exact and p.q_exact) exact,
           max(case when k.exact and p.q_exact then 1.0 when k.exact or p.q_exact then 0.6 else 0.45 end
               * case when k.source = 'brand' then 1.0 else 0.7 end
               * case when p.i <= 1 then 1.0 else 0.8 end)::numeric s
      from probes p join public.discover_bag_keys k on k.key = p.key
     group by 1, 2)
  select b.brand, round(sum(h.s) + least(0.2, ln(1 + b.labels)::numeric / 50), 3), count(distinct h.i)::int,
         count(*) filter (where h.exact)::int, b.labels
    from hits h join public.discover_brand_bags b on b.brand_norm = h.brand_norm
   group by b.brand, b.labels
   order by 2 desc limit greatest(1, least(p_limit, 20))
$$;
revoke all on function public.discover_letter_lookup(text[], int) from public, anon;
grant execute on function public.discover_letter_lookup(text[], int) to authenticated, service_role;
