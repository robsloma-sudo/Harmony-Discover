alter table public.bottle_sightings
  add column if not exists discover_product_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='bottle_sightings_discover_product_id_fkey'
      and conrelid='public.bottle_sightings'::regclass
  ) then
    alter table public.bottle_sightings
      add constraint bottle_sightings_discover_product_id_fkey
      foreign key(discover_product_id)
      references public.discover_products(id)
      on delete set null;
  end if;
end $$;

create index if not exists bottle_sightings_discover_product_idx
  on public.bottle_sightings(discover_product_id)
  where discover_product_id is not null;

comment on column public.bottle_sightings.discover_product_id is
  'Links an individual bottle scan to the persistent Discover-owned product intelligence record.';
