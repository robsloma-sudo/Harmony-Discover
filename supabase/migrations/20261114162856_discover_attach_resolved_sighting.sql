-- Harmony Discover DEV: saved scans use the brand + line + release + size identity.
-- discover-live-autosave resolves every bottle with discover_resolve_bottle() and then calls this.
--  * matched  -> one Discover product per identity (key 'id1:' || md5(identity_key)),
--                named brand + line (+ release), never the category words.
--  * reader product is only category words ("Kentucky Straight Bourbon Whiskey") -> the sighting
--                is kept but no product is created from the category words.
--  * anything else -> the existing attach path, unchanged.
-- shape_key = brand|line|size: what a liquid-level volume calibration belongs to (the glass is the
-- same across releases). It is withheld when the barcode and the label words disagree.
create or replace function public.discover_attach_resolved_sighting(p_sighting_id uuid, p_resolved jsonb)
returns table(r_product_id uuid, r_created boolean, r_identity_status text, r_shape_key text)
language plpgsql security definer set search_path = '' as $$
declare
  s public.bottle_sightings%rowtype;
  v_status text := coalesce(p_resolved ->> 'status', 'line_unknown');
  v_flags jsonb := coalesce(p_resolved -> 'flags', '[]'::jsonb);
  v_shape text;
  v_key text;
  v_product uuid;
  v_created boolean := false;
  v_category uuid;
  v_release text;
begin
  select * into s from public.bottle_sightings where id = p_sighting_id for update;
  if not found then raise exception 'Bottle sighting not found'; end if;

  if nullif(p_resolved ->> 'line', '') is not null and (p_resolved ->> 'size_ml') ~ '^[0-9]+(\.[0-9]+)?$'
     and not (v_flags ? 'barcode_and_label_words_disagree') then
    v_shape := concat_ws('|', public.discover_norm(p_resolved ->> 'brand'), public.discover_norm(p_resolved ->> 'line'),
      round((p_resolved ->> 'size_ml')::numeric)::text || 'ml');
  end if;

  update public.bottle_sightings
     set label_details = coalesce(label_details, '{}'::jsonb)
       || jsonb_build_object('_identity', (p_resolved - 'unclassified_words' - 'candidates') || jsonb_build_object('shape_key', v_shape))
   where id = s.id;

  if v_status = 'matched' and nullif(p_resolved ->> 'identity_key', '') is not null then
    v_key := 'id1:' || md5(p_resolved ->> 'identity_key');
    select c.phg_category_id into v_category from public.phg_category_mirror c
     where c.phg_category_id::text = p_resolved #>> '{category,phg_category_id}';
    v_release := case when p_resolved #>> '{release,key}' is distinct from 'standard' then p_resolved #>> '{release,label}' end;
    insert into public.discover_products(brand_name, product_name, expression_variant, product_class, category_phg_id, upc_gtin,
      match_confidence, identity_payload, candidate_identity_key, status, created_from)
    values (p_resolved ->> 'brand', p_resolved ->> 'line', v_release, s.read_category, v_category, p_resolved ->> 'gtin',
      greatest(0.9, least(1, coalesce(s.read_confidence, 0)))::numeric,
      jsonb_build_object('identity_status', 'resolved', 'identity_key', p_resolved ->> 'identity_key', 'shape_key', v_shape,
        'resolver_version', p_resolved ->> 'resolver_version', 'line_source', p_resolved ->> 'line_source',
        'release', p_resolved -> 'release', 'sighting_id', s.id),
      v_key, 'identified', 'bottle_scan')
    on conflict (candidate_identity_key) where candidate_identity_key is not null
    do update set last_seen_at = now(), updated_at = now(),
      upc_gtin = coalesce(public.discover_products.upc_gtin, excluded.upc_gtin)
    returning id, (xmax = 0) into v_product, v_created;

    update public.bottle_sightings set discover_product_id = v_product, product_index_id = null, match_score = null where id = s.id;
    insert into public.discover_product_evidence(discover_product_id, source_type, source_name, observed_value, confidence, verification_state, metadata)
    values (v_product, 'model_inference', coalesce(s.read_model, s.reader, 'Discover bottle reader'),
      jsonb_build_object('brand', s.read_brand, 'product', s.read_product, 'category', s.read_category, 'proof', s.read_proof,
        'size', s.read_size, 'label_text', s.label_text, 'resolved', p_resolved - 'unclassified_words' - 'candidates'),
      greatest(0, least(1, coalesce(s.read_confidence, 0)))::numeric, 'unreviewed',
      jsonb_build_object('sighting_id', s.id, 'reader_version', s.reader_version, 'identity_key', p_resolved ->> 'identity_key'));
    begin
      insert into public.discover_enrichment_jobs(discover_product_id, job_type, priority, input_payload)
      values (v_product, 'official_source_lookup', 30, jsonb_build_object('sighting_id', s.id));
    exception when unique_violation then null;
    end;
    return query select v_product, v_created, v_status, v_shape;
    return;
  end if;

  if v_flags ? 'reader_product_is_only_category_words' and nullif(p_resolved ->> 'line', '') is null then
    return query select null::uuid, false, 'category_words_only'::text, v_shape;
    return;
  end if;

  return query select a.discover_product_id, a.created_new, v_status, v_shape
    from public.discover_attach_sighting_to_product(p_sighting_id) a;
end $$;

revoke all on function public.discover_attach_resolved_sighting(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.discover_attach_resolved_sighting(uuid, jsonb) to service_role;
