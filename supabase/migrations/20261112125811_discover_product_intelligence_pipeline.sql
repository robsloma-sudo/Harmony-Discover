-- Discover-owned product intelligence mirror and enrichment pipeline.
-- PHG production is a read-only source; no foreign DB writes occur here.

create table if not exists public.phg_category_mirror (
  phg_category_id uuid primary key,
  parent_phg_category_id uuid references public.phg_category_mirror(phg_category_id) on delete set null,
  name text not null,
  slug text not null,
  node_kind text not null,
  level smallint not null,
  path text not null,
  authority_note text,
  notes text,
  proposal_status text not null,
  sort_order integer not null default 100,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  raw_snapshot jsonb not null default '{}'::jsonb
);
create index if not exists phg_category_mirror_path_idx on public.phg_category_mirror(path);
create index if not exists phg_category_mirror_parent_idx on public.phg_category_mirror(parent_phg_category_id);

create table if not exists public.phg_attribute_dimension_mirror (
  code text primary key,
  label text not null,
  multi_valued boolean not null default false,
  sort_order integer not null default 100,
  notes text,
  synced_at timestamptz not null default now()
);

create table if not exists public.phg_attribute_value_mirror (
  phg_attribute_value_id uuid primary key,
  dimension_code text not null references public.phg_attribute_dimension_mirror(code) on update cascade,
  code text not null,
  label text not null,
  parent_phg_attribute_value_id uuid references public.phg_attribute_value_mirror(phg_attribute_value_id) on delete set null,
  phg_category_id uuid references public.phg_category_mirror(phg_category_id) on delete set null,
  active boolean not null default true,
  notes text,
  synced_at timestamptz not null default now(),
  raw_snapshot jsonb not null default '{}'::jsonb,
  unique(dimension_code, code, phg_category_id)
);
create index if not exists phg_attribute_value_dimension_idx on public.phg_attribute_value_mirror(dimension_code, active);

create table if not exists public.discover_products (
  id uuid primary key default gen_random_uuid(),
  phg_product_id uuid,
  phg_brand_id uuid,
  phg_brand_line_id uuid,
  brand_name text not null,
  product_name text,
  category_phg_id uuid references public.phg_category_mirror(phg_category_id) on delete set null,
  product_class text,
  expression_variant text,
  upc_gtin text,
  ean text,
  status text not null default 'candidate'
    check (status in ('candidate','identified','enriching','needs_review','verified','export_queued','exported','rejected')),
  match_confidence numeric(5,4) check (match_confidence between 0 and 1),
  identity_payload jsonb not null default '{}'::jsonb,
  created_from text not null default 'bottle_scan',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(phg_product_id)
);
create index if not exists discover_products_brand_name_idx on public.discover_products(lower(brand_name));
create index if not exists discover_products_upc_idx on public.discover_products(upc_gtin) where upc_gtin is not null;
create index if not exists discover_products_status_idx on public.discover_products(status);

create table if not exists public.discover_product_packages (
  id uuid primary key default gen_random_uuid(),
  discover_product_id uuid not null references public.discover_products(id) on delete cascade,
  phg_package_id uuid,
  package_size_ml numeric,
  abv_percent numeric,
  package_type text,
  container_material text,
  upc_gtin text,
  ean text,
  label_approval_id text,
  package_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(phg_package_id)
);
create index if not exists discover_product_packages_upc_idx on public.discover_product_packages(upc_gtin) where upc_gtin is not null;

create table if not exists public.discover_product_attributes (
  id uuid primary key default gen_random_uuid(),
  discover_product_id uuid not null references public.discover_products(id) on delete cascade,
  attribute_code text not null,
  value_text text,
  value_numeric numeric,
  value_json jsonb,
  unit text,
  state text not null default 'queued'
    check (state in ('queued','found','not_disclosed','not_applicable','conflicting','needs_review')),
  confidence numeric(5,4) check (confidence between 0 and 1),
  evidence_id uuid,
  updated_at timestamptz not null default now(),
  unique(discover_product_id, attribute_code)
);
create index if not exists discover_product_attributes_state_idx on public.discover_product_attributes(state, attribute_code);

create table if not exists public.discover_product_evidence (
  id uuid primary key default gen_random_uuid(),
  discover_product_id uuid not null references public.discover_products(id) on delete cascade,
  attribute_code text,
  source_type text not null check (source_type in ('official_producer','ttb_cola','government_registry','barcode_registry','retailer','web_search','user_photo','model_inference','other')),
  source_name text,
  source_url text,
  source_record_id text,
  observed_value jsonb not null,
  confidence numeric(5,4) check (confidence between 0 and 1),
  verification_state text not null default 'unreviewed'
    check (verification_state in ('unreviewed','corroborated','verified','rejected','conflicting')),
  captured_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists discover_product_evidence_product_idx on public.discover_product_evidence(discover_product_id, attribute_code);
create index if not exists discover_product_evidence_source_idx on public.discover_product_evidence(source_type, source_record_id);

alter table public.discover_product_attributes
  drop constraint if exists discover_product_attributes_evidence_id_fkey;
alter table public.discover_product_attributes
  add constraint discover_product_attributes_evidence_id_fkey
  foreign key (evidence_id) references public.discover_product_evidence(id) on delete set null;

create table if not exists public.discover_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  discover_product_id uuid not null references public.discover_products(id) on delete cascade,
  job_type text not null check (job_type in ('identity_match','barcode_lookup','cola_lookup','official_source_lookup','field_extraction','conflict_resolution','refresh')),
  status text not null default 'queued' check (status in ('queued','processing','complete','retry','failed','cancelled')),
  priority smallint not null default 50,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists discover_enrichment_jobs_claim_idx on public.discover_enrichment_jobs(status, priority, available_at);

create table if not exists public.discover_phg_export_queue (
  id uuid primary key default gen_random_uuid(),
  discover_product_id uuid not null references public.discover_products(id) on delete restrict,
  phg_product_id uuid,
  export_status text not null default 'pending_review'
    check (export_status in ('pending_review','approved','rejected','exported','blocked')),
  payload jsonb not null,
  validation_report jsonb not null default '{}'::jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  exported_at timestamptz,
  phg_import_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists discover_phg_export_queue_status_idx on public.discover_phg_export_queue(export_status, created_at);

-- All new intelligence tables are backend-only by default. API/service role owns access.
alter table public.phg_category_mirror enable row level security;
alter table public.phg_attribute_dimension_mirror enable row level security;
alter table public.phg_attribute_value_mirror enable row level security;
alter table public.discover_products enable row level security;
alter table public.discover_product_packages enable row level security;
alter table public.discover_product_attributes enable row level security;
alter table public.discover_product_evidence enable row level security;
alter table public.discover_enrichment_jobs enable row level security;
alter table public.discover_phg_export_queue enable row level security;

revoke all on public.phg_category_mirror, public.phg_attribute_dimension_mirror,
  public.phg_attribute_value_mirror, public.discover_products,
  public.discover_product_packages, public.discover_product_attributes,
  public.discover_product_evidence, public.discover_enrichment_jobs,
  public.discover_phg_export_queue from anon, authenticated;
