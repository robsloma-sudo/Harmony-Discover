-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116192608 "discover_label_lookup" was applied live but was never committed to the repo.
create or replace function public.discover_label_lookup(p_text text, p_limit int default 5)
returns table(brand text, product text, class_type text, origin text, producer text, labels bigint, latest date, latest_ttb_id text, similarity real)
language sql stable security definer set search_path = public, extensions as $$
  with q as (select lower(trim(p_text)) t)
  select c.brand, c.product, mode() within group (order by c.class_type), mode() within group (order by c.origin),
         mode() within group (order by c.producer), count(*), max(c.approved), (array_agg(c.ttb_id order by c.approved desc))[1],
         max(similarity(c.search_text, q.t))
  from public.discover_label_catalog c, q
  where length(q.t) >= 3 and c.search_text % q.t
  group by c.brand, c.product
  order by max(similarity(c.search_text, q.t)) desc, count(*) desc
  limit greatest(1, least(p_limit, 20));
$$;
revoke all on function public.discover_label_lookup(text, int) from public, anon, authenticated;
grant execute on function public.discover_label_lookup(text, int) to service_role;
