-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261117102343 "discover_fragment_lookup_v3" was applied live but was never committed to the repo.
create or replace function public.discover_fragment_lookup(p_fragments text[], p_limit int default 5)
returns table(brand text, score numeric, labels int, fragments_matched int, coverage numeric)
language sql stable security definer set search_path = public, extensions as $$
  with f as (
    select distinct regexp_replace(lower(x), '[^a-z]', '', 'g') frag
      from unnest(coalesce(p_fragments, '{}'::text[])) x
  ), base as (
    select frag from f where length(frag) between 4 and 30 limit 6
  ), frags as (
    -- The letter at a cut edge is often half visible and misread: also try without the first or last letter.
    select frag, frag src, 1.0 w from base
    union all select substr(frag, 2), frag, 0.9 from base where length(frag) >= 6
    union all select left(frag, -1), frag, 0.9 from base where length(frag) >= 6
  ), hits as (
    select b.brand_norm, b.brand, b.labels, fr.src,
           (length(fr.frag)::numeric / greatest(1, length(b.letters))) * fr.w cov,
           exists (select 1 from regexp_split_to_table(lower(b.brand_norm), '[^a-z]+') w
                    where w <> '' and (w like fr.frag || '%' or w like '%' || fr.frag)) edge
      from frags fr
      join public.discover_brand_bags b on b.letters like '%' || fr.frag || '%'
     where length(b.letters) <= length(fr.frag) * 3 + 4
       -- A whole brand read cleanly is the letter search's job, not a part-word.
       and b.letters <> fr.src
  ), best as (
    select distinct on (brand_norm, src) brand_norm, brand, labels, src, cov, edge
      from hits order by brand_norm, src, cov * case when edge then 1 else 0.7 end desc
  ), per_brand as (
    select brand_norm, max(brand) brand, max(labels) labels, count(*) n,
           least(1, sum(cov)) cover, sum(cov * case when edge then 1 else 0.7 end) frag_score
      from best group by brand_norm
  )
  select brand, round(frag_score + 0.12 * log(10, labels + 1)::numeric, 3), labels, n::int, round(cover, 3)
    from per_brand
   order by frag_score + 0.12 * log(10, labels + 1) desc, labels desc
   limit greatest(1, least(p_limit, 10));
$$;
revoke all on function public.discover_fragment_lookup(text[], int) from public, anon;
grant execute on function public.discover_fragment_lookup(text[], int) to authenticated;
