create index if not exists phg_attribute_value_parent_idx
  on public.phg_attribute_value_mirror(parent_phg_attribute_value_id);
create index if not exists phg_attribute_value_category_idx
  on public.phg_attribute_value_mirror(phg_category_id);
create index if not exists discover_products_category_idx
  on public.discover_products(category_phg_id);
create index if not exists discover_product_packages_product_idx
  on public.discover_product_packages(discover_product_id);
create index if not exists discover_product_attributes_evidence_idx
  on public.discover_product_attributes(evidence_id);
create index if not exists discover_enrichment_jobs_product_idx
  on public.discover_enrichment_jobs(discover_product_id);
create index if not exists discover_phg_export_queue_product_idx
  on public.discover_phg_export_queue(discover_product_id);

revoke all on public.phg_category_mirror, public.phg_attribute_dimension_mirror,
  public.phg_attribute_value_mirror, public.discover_products,
  public.discover_product_packages, public.discover_product_attributes,
  public.discover_product_evidence, public.discover_enrichment_jobs,
  public.discover_phg_export_queue from public, anon, authenticated;

comment on table public.phg_category_mirror is 'Discover-local mirror of PHG beverage_categories; PHG remains canonical.';
comment on table public.phg_attribute_dimension_mirror is 'Discover-local mirror of PHG beverage_attribute_dimensions.';
comment on table public.phg_attribute_value_mirror is 'Discover-local mirror of PHG beverage_attribute_values.';
comment on table public.discover_products is 'Discover-owned product catalog and candidates; canonical PHG IDs retained when matched.';
comment on table public.discover_product_evidence is 'Field-level source evidence and verification provenance for Discover product intelligence.';
comment on table public.discover_enrichment_jobs is 'Backend-only queue for low-cost, batched product identification and enrichment.';
comment on table public.discover_phg_export_queue is 'Controlled review queue; no automatic writes to PHG production.';
