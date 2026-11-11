create extension if not exists postgis with schema extensions;

create table if not exists public.discover_venues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 180),
  slug text unique,
  venue_type text not null default 'other' check (venue_type in ('bar','restaurant','brewery','winery','distillery','cocktail_bar','hotel','other')),
  description text,
  address_line text,
  locality text,
  region text,
  postal_code text,
  country_code text not null default 'US',
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  location extensions.geography(Point,4326) generated always as (
    extensions.st_setsrid(extensions.st_makepoint(longitude,latitude),4326)::extensions.geography
  ) stored,
  phone text,
  website_url text,
  hero_image_url text,
  source_provider text,
  source_place_id text,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','community_verified','source_verified','rejected')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_provider,source_place_id)
);

create index if not exists discover_venues_location_gix on public.discover_venues using gist(location);
create index if not exists discover_venues_active_type_idx on public.discover_venues(is_active,venue_type);

create table if not exists public.discover_venue_submissions (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 180),
  venue_type text not null default 'other' check (venue_type in ('bar','restaurant','brewery','winery','distillery','cocktail_bar','hotel','other')),
  address_text text,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  website_url text,
  notes text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

alter table public.discover_venues enable row level security;
alter table public.discover_venue_submissions enable row level security;

drop policy if exists "Public can read active Discover venues" on public.discover_venues;
create policy "Public can read active Discover venues" on public.discover_venues
  for select to anon, authenticated using (is_active and verification_status <> 'rejected');

drop policy if exists "Users can submit venues" on public.discover_venue_submissions;
create policy "Users can submit venues" on public.discover_venue_submissions
  for insert to authenticated with check (auth.uid() = submitted_by);

grant select on public.discover_venues to anon, authenticated;
grant insert on public.discover_venue_submissions to authenticated;

create or replace function public.discover_nearby_venues(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_miles integer default 5,
  p_venue_type text default null,
  p_limit integer default 100
)
returns table (
  id uuid, name text, venue_type text, description text,
  address_line text, locality text, region text, postal_code text,
  latitude double precision, longitude double precision,
  distance_miles double precision, hero_image_url text,
  website_url text, phone text, verification_status text
)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
  select v.id, v.name, v.venue_type, v.description,
    v.address_line, v.locality, v.region, v.postal_code,
    v.latitude, v.longitude,
    round((extensions.st_distance(
      v.location,
      extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography
    ) / 1609.344)::numeric, 2)::double precision as distance_miles,
    v.hero_image_url, v.website_url, v.phone, v.verification_status
  from public.discover_venues v
  where p_latitude between -90 and 90
    and p_longitude between -180 and 180
    and p_radius_miles in (1,5,10,15,20)
    and v.is_active
    and v.verification_status <> 'rejected'
    and (p_venue_type is null or v.venue_type = p_venue_type)
    and extensions.st_dwithin(
      v.location,
      extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography,
      p_radius_miles * 1609.344
    )
  order by v.location operator(extensions.<->)
    extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography
  limit least(greatest(p_limit,1),200);
$$;

revoke all on function public.discover_nearby_venues(double precision,double precision,integer,text,integer) from public;
grant execute on function public.discover_nearby_venues(double precision,double precision,integer,text,integer) to anon, authenticated;

comment on table public.discover_venues is 'Harmony Discover DEV venue directory. Isolated from Harmony canonical production tables.';
comment on function public.discover_nearby_venues(double precision,double precision,integer,text,integer) is 'Returns active Discover venues within an allowed radius (miles) of a coordinate.';

