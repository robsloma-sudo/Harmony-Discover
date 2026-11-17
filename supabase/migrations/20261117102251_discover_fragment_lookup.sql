-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261117102251 "discover_fragment_lookup" was applied live but was never committed to the repo.
alter table public.discover_brand_bags add column if not exists letters text generated always as (regexp_replace(lower(brand_norm), '[^a-z]', '', 'g')) stored;
create index if not exists discover_brand_bags_letters_trgm on public.discover_brand_bags using gin (letters extensions.gin_trgm_ops);

-- Part-words: a round bottle hides or squeezes the letters at its edges, so the phone often reads only
-- part of a brand ("CARDI" of BACARDI, "URKEY" of TURKEY). Finds brands whose letters contain each
-- fragment in order, scoring how much of the brand the fragments cover and whether a fragment starts
-- or ends a word (where the curve cuts letters off).
create or replace function public.discover_fragment_lookup(p_fragments text[], p_limit int default 5)
returns table(brand text, score numeric, labels int, fragments_matched int, coverage numeric)
language sql stable security definer set search_path = public, extensions as $$
  with f as (
    select distinct regexp_replace(lower(x), '[^a-z]', '', 'g') frag
      from unnest(coalesce(p_fragments, '{}'::text[])) x
  ), frags as (
    select frag from f where length(frag) between 4 and 30 limit 6
  ), hits as (
    select b.brand_norm, b.brand, b.labels, b.letters, fr.frag,
           length(fr.frag)::numeric / greatest(1, length(b.letters)) cov,
           exists (select 1 from regexp_split_to_table(lower(b.brand_norm), '[^a-z]+') w
                    where w <> '' and (w like fr.frag || '%' or w like '%' || fr.frag)) edge
      from frags fr
      join public.discover_brand_bags b on b.letters like '%' || fr.frag || '%'
     where length(b.letters) <= length(fr.frag) * 3 + 4
  ), per_brand as (
    select brand_norm, max(brand) brand, max(labels) labels,
           count(distinct frag) n,
           least(1, sum(cov)) cover,
           sum(cov * case when edge then 1 else 0.7 end) frag_score
      from hits group by brand_norm
  )
  select brand, round(frag_score + 0.12 * log(10, labels + 1)::numeric, 3) score, labels, n::int, round(cover, 3)
    from per_brand
   order by frag_score + 0.12 * log(10, labels + 1) desc, labels desc
   limit greatest(1, least(p_limit, 10));
$$;
revoke all on function public.discover_fragment_lookup(text[], int) from public, anon;
grant execute on function public.discover_fragment_lookup(text[], int) to authenticated;
