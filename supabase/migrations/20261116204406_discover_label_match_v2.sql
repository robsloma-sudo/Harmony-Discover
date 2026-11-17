-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116204406 "discover_label_match_v2" was applied live but was never committed to the repo.

create or replace function public.discover_label_match(p_product uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare d record; v_ttb text; v_score numeric; v_raw text; v_norm text; top record; v_phg_ttb text; db text; lb text; ok boolean := false;
begin
  select id, brand_name, product_name, phg_match_product_id, cola_ttb_id into d from public.discover_products where id = p_product;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_product'); end if;
  select p.ttb_id into v_phg_ttb from public.discover_phg_products p where p.phg_product_id = d.phg_match_product_id and p.ttb_id ~ '^\d{8,}$';
  v_raw := lower(trim(coalesce(d.brand_name, '') || ' ' || coalesce(d.product_name, '')));
  v_norm := public.discover_norm(v_raw);
  if length(v_raw) >= 4 then
    create temp table if not exists _lm (brand text, product text, producer text, labels bigint, latest_ttb_id text, similarity real) on commit drop;
    truncate _lm;
    insert into _lm select l.brand, l.product, l.producer, l.labels, l.latest_ttb_id, l.similarity from public.discover_label_lookup(v_raw, 5) l;
    if v_norm <> v_raw then
      insert into _lm select l.brand, l.product, l.producer, l.labels, l.latest_ttb_id, l.similarity from public.discover_label_lookup(v_norm, 5) l;
    end if;
    select * into top from _lm where similarity >= (select max(similarity) from _lm) - 0.02
     order by similarity desc, (producer is not null) desc, labels desc limit 1;
    if found and top.similarity >= 0.8 then
      db := regexp_replace(public.discover_norm(d.brand_name), '^the ', '');
      lb := regexp_replace(public.discover_norm(top.brand), '^the ', '');
      ok := db = lb or similarity(db, lb) >= 0.8
         or (length(lb) >= 4 and position(' ' || lb || ' ' in ' ' || db || ' ') > 0)
         or (length(db) >= 4 and position(' ' || db || ' ' in ' ' || lb || ' ') > 0)
         or public.discover_norm(top.brand || ' ' || coalesce(top.product, '')) = v_norm;
    end if;
    if ok then v_ttb := top.latest_ttb_id; v_score := round(top.similarity::numeric, 2); end if;
  end if;
  if v_ttb is null and v_phg_ttb is not null then v_ttb := v_phg_ttb; v_score := 0.7; end if;
  if v_ttb is null then
    return jsonb_build_object('ok', false, 'reason', 'no_confident_label', 'best', top.brand || ' / ' || coalesce(top.product, ''), 'similarity', top.similarity);
  end if;
  update public.discover_products set cola_ttb_id = v_ttb, cola_match_score = v_score, cola_matched_at = now()
   where id = p_product and cola_ttb_id is distinct from v_ttb;
  insert into public.discover_cola_detail_wanted(ttb_id, discover_product_id)
  select v_ttb, p_product where not exists (select 1 from public.discover_cola_details c where c.ttb_id = v_ttb)
  on conflict (ttb_id) do nothing;
  return jsonb_build_object('ok', true, 'ttb_id', v_ttb, 'score', v_score);
end $$;
revoke all on function public.discover_label_match(uuid) from public, anon, authenticated;
