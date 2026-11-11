-- Discover DEV: add label detail fields extracted by discover-live-read.
alter table public.bottle_sightings add column if not exists read_vintage integer;
alter table public.bottle_sightings add column if not exists label_details jsonb not null default '{}'::jsonb;
