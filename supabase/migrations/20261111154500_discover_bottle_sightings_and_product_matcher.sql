-- Harmony Discover DEV: bottle sightings ledger, product matcher and scan usage caps.
-- Additive only. Service-role writes; consumers may read their own sightings.
create extension if not exists pg_trgm with schema extensions;

create or replace function public.discover_norm(p text)
returns text language sql immutable parallel safe set search_path = ''
as $$
  select btrim(regexp_replace(
    translate(lower(coalesce(p, '')), 'áàâäãåéèêëíìîïóòôöõúùûüñç’''', 'aaaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

create table if not exists public.product_index (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  product text,
  category text,
  proof numeric,
  aliases text[] not null default '{}',
  source text not null,
  search_norm text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists product_index_search_trgm on public.product_index using gin (search_norm extensions.gin_trgm_ops);

create table if not exists public.bottle_sightings (
  id uuid primary key default gen_random_uuid(),
  consumer_id uuid not null references auth.users(id) on delete cascade,
  scan_session_id uuid not null,
  venue_id uuid references public.discover_venues(id) on delete set null,
  venue_name_submitted text,
  product_index_id uuid references public.product_index(id) on delete set null,
  match_score real,
  read_brand text,
  read_product text,
  read_category text,
  read_proof text,
  read_size text,
  label_text text,
  read_confidence real,
  method text not null default 'vision_frame' check (method in ('vision_frame','on_device_text','barcode','manual')),
  evidence_state text not null default 'reported' check (evidence_state in ('reported','user_confirmed','user_corrected','rejected')),
  reader text not null,
  reader_version text not null,
  read_model text,
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists bottle_sightings_consumer_idx on public.bottle_sightings (consumer_id, seen_at desc);
create index if not exists bottle_sightings_product_idx on public.bottle_sightings (product_index_id);
create index if not exists bottle_sightings_venue_idx on public.bottle_sightings (venue_id);

create table if not exists public.bottle_scan_usage (
  consumer_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  frames integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (consumer_id, day)
);

alter table public.product_index enable row level security;
alter table public.bottle_sightings enable row level security;
alter table public.bottle_scan_usage enable row level security;
revoke all on public.product_index, public.bottle_sightings, public.bottle_scan_usage from anon, authenticated;
grant select on public.bottle_sightings to authenticated;
drop policy if exists "Consumers read own bottle sightings" on public.bottle_sightings;
create policy "Consumers read own bottle sightings" on public.bottle_sightings
  for select to authenticated using ((select auth.uid()) = consumer_id);

-- One frame = one paid read. Counts it and refuses once the person or the whole project is over the day's cap.
create or replace function public.discover_bottle_scan_allow(p_subject uuid, p_user_max integer, p_global_max integer)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_day date := (now() at time zone 'utc')::date; v_user integer; v_all bigint;
begin
  select coalesce(sum(frames), 0) into v_all from public.bottle_scan_usage where day = v_day;
  if v_all >= p_global_max then return false; end if;
  insert into public.bottle_scan_usage (consumer_id, day, frames) values (p_subject, v_day, 1)
    on conflict (consumer_id, day) do update set frames = public.bottle_scan_usage.frames + 1
    returning frames into v_user;
  if v_user > p_user_max then
    update public.bottle_scan_usage set frames = frames - 1 where consumer_id = p_subject and day = v_day;
    return false;
  end if;
  return true;
end $$;

create or replace function public.discover_bottle_scan_tokens(p_subject uuid, p_in bigint, p_out bigint)
returns void language sql security definer set search_path = ''
as $$
  update public.bottle_scan_usage set input_tokens = input_tokens + greatest(p_in, 0), output_tokens = output_tokens + greatest(p_out, 0)
  where consumer_id = p_subject and day = (now() at time zone 'utc')::date
$$;

-- Best product_index match for each piece of label text. Text in, product out, with a score from 0 to 1.
create or replace function public.discover_match_products(p_queries text[])
returns table (q text, id uuid, brand text, product text, category text, proof numeric, score real)
language sql stable security definer set search_path = ''
as $$
  select u.q, m.id, m.brand, m.product, m.category, m.proof, m.score
  from unnest(p_queries) as u(q)
  left join lateral (
    select pi.id, pi.brand, pi.product, pi.category, pi.proof,
           greatest(extensions.similarity(pi.search_norm, public.discover_norm(u.q)),
                    extensions.word_similarity(pi.search_norm, public.discover_norm(u.q)))::real as score
    from public.product_index pi
    where length(public.discover_norm(u.q)) >= 2
      and (pi.search_norm operator(extensions.%) public.discover_norm(u.q)
           or pi.search_norm operator(extensions.<%) public.discover_norm(u.q))
    order by 6 desc, length(pi.search_norm) desc
    limit 1
  ) m on true
$$;

revoke execute on function public.discover_bottle_scan_allow(uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.discover_bottle_scan_tokens(uuid, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.discover_match_products(text[]) from public, anon, authenticated;
grant execute on function public.discover_bottle_scan_allow(uuid, integer, integer) to service_role;
grant execute on function public.discover_bottle_scan_tokens(uuid, bigint, bigint) to service_role;
grant execute on function public.discover_match_products(text[]) to service_role;

-- Label facts beyond brand and product: producer, vintage, region, appellation, grapes, class, age,
-- cask finish, flavour, batch, importer and certification marks. Only what is printed on the label.
alter table public.bottle_sightings add column if not exists read_vintage integer;
alter table public.bottle_sightings add column if not exists label_details jsonb not null default '{}'::jsonb;
