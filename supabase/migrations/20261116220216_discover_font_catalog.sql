-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116220216 "discover_font_catalog" was applied live but was never committed to the repo.

-- Open-licence fonts we may use to teach the on-phone label reader (render brand names in them).
-- Sources: Fontsource and Google Fonts (open licences), Font Squirrel (free for commercial use).
create table if not exists public.discover_font_catalog (
  family text primary key,
  category text,
  tags text[] not null default '{}',
  script_like boolean not null default false,   -- handwriting, script, calligraphic, hand-drawn, blackletter
  license text,
  sources text[] not null default '{}',
  url text,
  popularity integer,
  used_for_training boolean not null default false,
  loaded_at timestamptz not null default now()
);
alter table public.discover_font_catalog enable row level security;
create or replace function public.discover_font_catalog_load(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.discover_font_catalog(family, category, tags, script_like, license, sources, url, popularity)
  select r->>'family', r->>'category', array(select jsonb_array_elements_text(r->'tags')), (r->>'script_like')::boolean, r->>'license',
         array(select jsonb_array_elements_text(r->'sources')), r->>'url', nullif(r->>'popularity','')::int
    from jsonb_array_elements(p_rows) r
  on conflict (family) do update set category = excluded.category, tags = excluded.tags, script_like = excluded.script_like,
    license = excluded.license, sources = excluded.sources, url = excluded.url, popularity = excluded.popularity, loaded_at = now();
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.discover_font_catalog_load(jsonb) from public, anon, authenticated;
