-- DESIGN/DEVELOPMENT MIGRATION ONLY.
-- Apply only to a newly provisioned Harmony Discover DEVELOPMENT project.
-- Never apply to Harmony production without a separate explicit authorization.
create extension if not exists pgcrypto;

create table if not exists public.menu_observations (
  id uuid primary key default gen_random_uuid(),
  consumer_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'created' check (status in ('created','uploading','received','processing','awaiting_venue','ready_for_review','complete','failed','withdrawn')),
  consent_to_processing boolean not null,
  consent_to_contribute boolean not null default false,
  venue_name_submitted text,
  capture_source text not null check (capture_source in ('camera','gallery')),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.observation_assets (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.menu_observations(id) on delete cascade,
  consumer_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null unique,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  sha256 text,
  processing_status text not null default 'received' check (processing_status in ('received','validated','rejected','processed','deleted')),
  created_at timestamptz not null default now()
);

create index if not exists menu_observations_consumer_created_idx on public.menu_observations(consumer_id, created_at desc);
create index if not exists observation_assets_observation_idx on public.observation_assets(observation_id);

alter table public.menu_observations enable row level security;
alter table public.observation_assets enable row level security;

-- Consumers can read their own observation metadata. Writes are mediated by the API service.
create policy "consumer reads own observations" on public.menu_observations
  for select to authenticated using (auth.uid() = consumer_id);
create policy "consumer reads own asset metadata" on public.observation_assets
  for select to authenticated using (auth.uid() = consumer_id);

-- Private storage bucket; object writes are mediated by the API service.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('observation-assets','observation-assets',false,15728640,array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

-- No storage object policies are created here: server-side service-role access only.
