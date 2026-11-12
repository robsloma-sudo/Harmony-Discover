-- Make official-source evidence writes idempotent across worker retries.
-- NULL source_record_id values remain unrestricted; worker-generated IDs are unique per product.
create unique index if not exists discover_product_evidence_source_record_uidx
  on public.discover_product_evidence (discover_product_id, source_record_id);
