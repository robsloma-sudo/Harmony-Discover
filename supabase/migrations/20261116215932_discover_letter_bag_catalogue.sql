-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116215932 "discover_letter_bag_catalogue" was applied live but was never committed to the repo.

-- Letter-count ("bag of letters") catalogue: a word is reduced to its letters sorted (Jameson -> aejmnos).
-- Order and spacing do not matter, so a scrambled or partly read word still finds its brand.
create or replace function public.discover_bag(p text) returns text language sql immutable parallel safe set search_path = public, extensions as $$
  select coalesce(string_agg(c, '' order by c), '') from regexp_split_to_table(lower(regexp_replace(unaccent(coalesce(p,'')), '[^a-zA-Z0-9]', '', 'g')), '') c where c <> ''
$$;

create table if not exists public.discover_brand_bags (
  brand_norm text primary key,
  brand text not null,
  bag text not null,                 -- all letters of the brand name
  word_bags text[] not null,         -- one bag per word (big words first)
  labels integer not null,
  updated_at timestamptz not null default now()
);
-- Keys for 1-letter tolerance (SymSpell style): the bag itself and the bag with any one letter removed.
create table if not exists public.discover_bag_keys (
  key text not null,
  brand_norm text not null,
  source text not null,              -- 'brand' (whole name) or 'word'
  exact boolean not null,
  primary key (key, brand_norm, source, exact)
);
alter table public.discover_brand_bags enable row level security;
alter table public.discover_bag_keys enable row level security;

create or replace function public.discover_bag_deletes(p_bag text) returns setof text language sql immutable parallel safe as $$
  select distinct left(p_bag, i - 1) || substr(p_bag, i + 1) from generate_series(1, length(p_bag)) i where length(p_bag) >= 5
$$;

create or replace function public.discover_brand_bags_refresh() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare n int; k int;
begin
  delete from public.discover_bag_keys where true;
  delete from public.discover_brand_bags where true;
  insert into public.discover_brand_bags(brand_norm, brand, bag, word_bags, labels)
  select bn, (array_agg(brand order by cnt desc))[1], public.discover_bag(bn),
         array(select public.discover_bag(w) from unnest(string_to_array(bn, ' ')) w where length(w) >= 2 order by length(w) desc), sum(cnt)::int
    from (select public.discover_norm(brand) bn, brand, count(*) cnt from public.discover_label_catalog
          where brand is not null group by 1, 2) s
   where length(public.discover_bag(bn)) >= 2
   group by bn;
  get diagnostics n = row_count;
  insert into public.discover_bag_keys(key, brand_norm, source, exact)
  select distinct key, brand_norm, source, exact from (
    select bag key, brand_norm, 'brand' source, true exact from public.discover_brand_bags
    union all select d, b.brand_norm, 'brand', false from public.discover_brand_bags b, public.discover_bag_deletes(b.bag) d
    union all select w, b.brand_norm, 'word', true from public.discover_brand_bags b, unnest(b.word_bags) w where length(w) >= 3 and cardinality(b.word_bags) > 1
    union all select d, b.brand_norm, 'word', false from public.discover_brand_bags b, unnest(b.word_bags) w, public.discover_bag_deletes(w) d where cardinality(b.word_bags) > 1
  ) z;
  get diagnostics k = row_count;
  return jsonb_build_object('brands', n, 'keys', k);
end $$;
revoke all on function public.discover_brand_bags_refresh() from public, anon, authenticated;
