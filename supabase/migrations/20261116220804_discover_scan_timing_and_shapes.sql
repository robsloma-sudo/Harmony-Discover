-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116220804 "discover_scan_timing_and_shapes" was applied live but was never committed to the repo.

create table if not exists public.discover_scan_timings (
  id bigserial primary key,
  consumer_id uuid not null,
  scan_session_id uuid,
  track_id text,
  named_by text not null check (named_by in ('barcode','letters','shape','ai_label','ai_frame','memory','none')),
  ms_to_first_box integer, ms_to_text integer, ms_to_name integer, ms_to_confirm integer,
  brand text, product text, discover_product_id uuid,
  label_px integer, zoom numeric, device text, app_version text,
  created_at timestamptz not null default now()
);
create index if not exists discover_scan_timings_created_idx on public.discover_scan_timings(created_at desc);

create table if not exists public.discover_shape_observations (
  id bigserial primary key,
  consumer_id uuid not null,
  discover_product_id uuid references public.discover_products(id) on delete cascade,
  size_ml numeric, container text, aspect numeric, shoulder_at numeric, neck_width numeric, base_width numeric,
  outline jsonb, colour jsonb, label_px integer, box_px integer, zoom numeric, rel_depth numeric,
  distance_band text, named_by text,
  created_at timestamptz not null default now()
);
create index if not exists discover_shape_obs_product_idx on public.discover_shape_observations(discover_product_id);

create table if not exists public.discover_shape_profiles (
  discover_product_id uuid not null references public.discover_products(id) on delete cascade,
  size_ml numeric not null default 0,
  container text not null default 'bottle',
  distance_band text not null default 'any',
  observations integer not null,
  aspect numeric, aspect_sd numeric, shoulder_at numeric, neck_width numeric, base_width numeric,
  outline jsonb, colour jsonb,
  updated_at timestamptz not null default now(),
  primary key (discover_product_id, size_ml, container, distance_band)
);
alter table public.discover_scan_timings enable row level security;
alter table public.discover_shape_observations enable row level security;
alter table public.discover_shape_profiles enable row level security;

create or replace function public.discover_distance_band(p_label_px integer, p_zoom numeric) returns text language sql immutable as $$
  select case when p_label_px is null then 'any'
              when p_label_px / greatest(coalesce(p_zoom, 1), 1) >= 600 then 'near'
              when p_label_px / greatest(coalesce(p_zoom, 1), 1) >= 300 then 'mid'
              when p_label_px / greatest(coalesce(p_zoom, 1), 1) >= 150 then 'far' else 'very_far' end
$$;

create or replace function public.discover_jsonb_avg(p jsonb[]) returns jsonb language sql immutable as $$
  select jsonb_agg(m order by i) from (
    select e.i, round(avg((e.v)::numeric), 4) m from unnest(p) a, jsonb_array_elements_text(a) with ordinality e(v, i) group by e.i) z
$$;

create or replace function public.discover_shape_profiles_refresh() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.discover_shape_profiles where true;
  insert into public.discover_shape_profiles(discover_product_id, size_ml, container, distance_band, observations,
     aspect, aspect_sd, shoulder_at, neck_width, base_width, outline, colour)
  select discover_product_id, coalesce(size_ml, 0), coalesce(container, 'bottle'), 'any', count(*),
         avg(aspect), stddev_samp(aspect), avg(shoulder_at), avg(neck_width), avg(base_width),
         public.discover_jsonb_avg(array_agg(outline) filter (where jsonb_typeof(outline) = 'array' and jsonb_array_length(outline) = 32)),
         public.discover_jsonb_avg(array_agg(colour) filter (where jsonb_typeof(colour) = 'array' and jsonb_array_length(colour) = 64))
    from public.discover_shape_observations where discover_product_id is not null
   group by 1, 2, 3;
  get diagnostics n = row_count; return n;
end $$;

create or replace function public.discover_shape_match(p_aspect numeric, p_shoulder numeric, p_neck numeric, p_colour jsonb, p_container text default null, p_limit int default 5)
returns table(discover_product_id uuid, brand text, product text, size_ml numeric, distance numeric, observations int)
language sql stable security definer set search_path = public as $$
  select p.discover_product_id, d.brand_name, d.product_name, p.size_ml,
         round((abs(p.aspect - p_aspect) / greatest(coalesce(p.aspect_sd, 0.08), 0.05)
               + coalesce(abs(p.shoulder_at - p_shoulder) * 8, 1) + coalesce(abs(p.neck_width - p_neck) * 6, 1)
               + coalesce((select sum(abs((a.v)::numeric - (b.v)::numeric)) * 3
                             from jsonb_array_elements_text(p.colour) with ordinality a(v, i)
                             join jsonb_array_elements_text(p_colour) with ordinality b(v, j) on a.i = b.j), 2))::numeric, 3) dist,
         p.observations
    from public.discover_shape_profiles p join public.discover_products d on d.id = p.discover_product_id
   where p_container is null or p.container = p_container
   order by dist limit greatest(1, least(p_limit, 20))
$$;

revoke all on function public.discover_shape_profiles_refresh() from public, anon, authenticated;
revoke all on function public.discover_shape_match(numeric, numeric, numeric, jsonb, text, int) from public, anon;
grant execute on function public.discover_shape_match(numeric, numeric, numeric, jsonb, text, int) to authenticated, service_role;
select cron.schedule('discover-shape-profiles-hourly', '25 * * * *', $c$ select public.discover_shape_profiles_refresh() $c$);
