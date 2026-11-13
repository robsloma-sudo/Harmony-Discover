create or replace function public.discover_attach_sighting_to_product(p_sighting_id uuid)
returns table(discover_product_id uuid, match_score numeric, created_new boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sighting public.bottle_sightings%rowtype;
  v_match record;
  v_product_id uuid;
  v_score numeric := 0;
  v_created boolean := false;
  v_category_id uuid;
  v_identity jsonb;
begin
  select * into v_sighting
  from public.bottle_sightings
  where id = p_sighting_id
  for update;

  if not found then
    raise exception 'Bottle sighting not found';
  end if;

  if v_sighting.discover_product_id is not null then
    return query select v_sighting.discover_product_id, 1::numeric, false;
    return;
  end if;

  -- Match against the inexpensive local product index first.
  select pi.id, pi.brand, pi.product, pi.category, pi.proof,
         greatest(
           extensions.similarity(pi.search_norm, public.discover_norm(
             concat_ws(' ', v_sighting.read_brand, v_sighting.read_product))),
           extensions.word_similarity(pi.search_norm, public.discover_norm(
             concat_ws(' ', v_sighting.read_brand, v_sighting.read_product)))
         )::numeric as score
    into v_match
  from public.product_index pi
  where length(public.discover_norm(concat_ws(' ',v_sighting.read_brand,v_sighting.read_product))) >= 3
  order by score desc
  limit 1;

  if v_match.id is not null and v_match.score >= 0.88 then
    v_score := v_match.score;
    select id into v_product_id
    from public.discover_products
    where phg_product_id = v_match.id
    limit 1;
  end if;

  -- Only attach to an existing PHG product when its canonical ID is actually present.
  if v_product_id is null and v_match.id is not null and v_match.score >= 0.88 then
    v_identity := jsonb_build_object(
      'matched_product_index_id', v_match.id,
      'matched_brand', v_match.brand,
      'matched_product', v_match.product,
      'matched_category', v_match.category,
      'matched_proof', v_match.proof,
      'match_method', 'local_fuzzy_index'
    );
    select phg_category_id into v_category_id
    from public.phg_category_mirror
    where lower(name) = lower(coalesce(v_sighting.read_category,v_match.category))
    order by level desc
    limit 1;

    insert into public.discover_products(
      brand_name,product_name,category_phg_id,product_class,match_confidence,
      identity_payload,status,created_from
    ) values (
      coalesce(v_sighting.read_brand,v_match.brand,'Unknown brand'),
      coalesce(v_sighting.read_product,v_match.product),
      v_category_id,
      coalesce(v_sighting.read_category,v_match.category),
      v_score,
      v_identity,
      'identified',
      'bottle_scan'
    ) returning id into v_product_id;
    v_created := true;
  elsif v_product_id is null then
    select phg_category_id into v_category_id
    from public.phg_category_mirror
    where lower(name) = lower(v_sighting.read_category)
    order by level desc
    limit 1;

    insert into public.discover_products(
      brand_name,product_name,category_phg_id,product_class,match_confidence,
      identity_payload,status,created_from
    ) values (
      coalesce(v_sighting.read_brand,'Unknown brand'),
      v_sighting.read_product,
      v_category_id,
      v_sighting.read_category,
      greatest(0,least(1,coalesce(v_sighting.read_confidence,0)))::numeric,
      jsonb_build_object(
        'sighting_id',v_sighting.id,
        'label_text',v_sighting.label_text,
        'read_proof',v_sighting.read_proof,
        'read_size',v_sighting.read_size,
        'read_vintage',v_sighting.read_vintage,
        'label_details',v_sighting.label_details,
        'identity_status','candidate'
      ),
      'candidate',
      'bottle_scan'
    ) returning id into v_product_id;
    v_created := true;
  end if;

  update public.bottle_sightings
  set discover_product_id = v_product_id
  where id = v_sighting.id;

  insert into public.discover_enrichment_jobs(discover_product_id,job_type,priority,input_payload)
  values
    (v_product_id,'identity_match',10,jsonb_build_object('sighting_id',v_sighting.id)),
    (v_product_id,'official_source_lookup',30,jsonb_build_object('sighting_id',v_sighting.id))
  on conflict do nothing;

  return query select v_product_id,v_score,v_created;
end;
$$;

revoke all on function public.discover_attach_sighting_to_product(uuid) from public, anon, authenticated;
grant execute on function public.discover_attach_sighting_to_product(uuid) to service_role;
