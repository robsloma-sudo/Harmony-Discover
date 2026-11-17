-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116204531 "discover_label_match_v4_group_facts" was applied live but was never committed to the repo.

create table if not exists public.discover_product_label_facts (
  discover_product_id uuid primary key references public.discover_products(id) on delete cascade,
  ttb_id text, brand text, product text, class_type text, origin text, producer text, permit_no text,
  labels integer, similarity numeric, source text, matched_at timestamptz not null default now()
);
alter table public.discover_product_label_facts enable row level security;

create or replace function public.discover_label_match(p_product uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare d record; v_raw text; v_norm text; top record; g record; v_phg_ttb text; db text; lb text; ok boolean := false;
        v_best text; v_best_sim real; v_ttb text; v_score numeric; v_src text;
begin
  select id, brand_name, product_name, phg_match_product_id into d from public.discover_products where id = p_product;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_product'); end if;
  if nullif(trim(coalesce(d.product_name, '')), '') is null then return jsonb_build_object('ok', false, 'reason', 'brand_only'); end if;
  select p.ttb_id into v_phg_ttb from public.discover_phg_products p where p.phg_product_id = d.phg_match_product_id and p.ttb_id ~ '^\d{8,}$';
  v_raw := lower(trim(d.brand_name || ' ' || d.product_name));
  v_norm := public.discover_norm(v_raw);
  create temp table if not exists _lm (brand text, product text, producer text, labels bigint, latest_ttb_id text, similarity real) on commit drop;
  truncate _lm;
  insert into _lm select l.brand, l.product, l.producer, l.labels, l.latest_ttb_id, l.similarity from public.discover_label_lookup(v_raw, 5) l;
  if v_norm <> v_raw then
    insert into _lm select l.brand, l.product, l.producer, l.labels, l.latest_ttb_id, l.similarity from public.discover_label_lookup(v_norm, 5) l;
  end if;
  select * into top from _lm where similarity >= (select max(similarity) from _lm) - 0.02
   order by similarity desc, (producer is not null) desc, labels desc limit 1;
  if found then
    v_best := top.brand || ' / ' || coalesce(top.product, ''); v_best_sim := top.similarity;
    db := regexp_replace(public.discover_norm(d.brand_name), '^the ', '');
    lb := regexp_replace(public.discover_norm(top.brand), '^the ', '');
    ok := top.similarity >= 0.8
      and (db = lb or similarity(db, lb) >= 0.8
           or (length(lb) >= 4 and position(' ' || lb || ' ' in ' ' || db || ' ') > 0)
           or (length(db) >= 4 and position(' ' || db || ' ' in ' ' || lb || ' ') > 0)
           or public.discover_norm(top.brand || ' ' || coalesce(top.product, '')) = v_norm)
      -- a rye and a bourbon are different bottles: the word "rye" must be on both or neither
      and ((v_norm ~ '\mrye\M') = (public.discover_norm(top.brand || ' ' || coalesce(top.product, '')) ~ '\mrye\M'));
  end if;
  if ok then
    -- What most of this label's approvals say (one odd approval does not decide origin or producer).
    select mode() within group (order by c.class_type) class_type, mode() within group (order by c.origin) origin,
           mode() within group (order by c.producer) filter (where c.producer is not null) producer, count(*) labels
      into g from public.discover_label_catalog c where lower(c.brand) = lower(top.brand) and c.product is not distinct from top.product;
    select c.ttb_id into v_ttb from public.discover_label_catalog c
     where lower(c.brand) = lower(top.brand) and c.product is not distinct from top.product
     order by (c.origin is not distinct from g.origin) desc, (c.producer is not distinct from g.producer) desc, c.approved desc limit 1;
    v_score := round(top.similarity::numeric, 2); v_src := 'label_catalogue';
    insert into public.discover_product_label_facts(discover_product_id, ttb_id, brand, product, class_type, origin, producer, permit_no, labels, similarity, source, matched_at)
    values (p_product, v_ttb, top.brand, top.product, g.class_type, g.origin, g.producer,
            (select mode() within group (order by c.permit_no) from public.discover_label_catalog c
              where lower(c.brand) = lower(top.brand) and c.product is not distinct from top.product and c.producer is not distinct from g.producer),
            g.labels, v_score, v_src, now())
    on conflict (discover_product_id) do update set ttb_id = excluded.ttb_id, brand = excluded.brand, product = excluded.product, class_type = excluded.class_type,
      origin = excluded.origin, producer = excluded.producer, permit_no = excluded.permit_no, labels = excluded.labels, similarity = excluded.similarity,
      source = excluded.source, matched_at = now();
  elsif v_phg_ttb is not null then
    v_ttb := v_phg_ttb; v_score := 0.7; v_src := 'harmony_label_link';
    delete from public.discover_product_label_facts where discover_product_id = p_product;
  else
    return jsonb_build_object('ok', false, 'reason', 'no_confident_label', 'best', v_best, 'similarity', v_best_sim);
  end if;
  update public.discover_products set cola_ttb_id = v_ttb, cola_match_score = v_score, cola_matched_at = now()
   where id = p_product and cola_ttb_id is distinct from v_ttb;
  insert into public.discover_cola_detail_wanted(ttb_id, discover_product_id)
  select v_ttb, p_product where not exists (select 1 from public.discover_cola_details c where c.ttb_id = v_ttb)
  on conflict (ttb_id) do nothing;
  return jsonb_build_object('ok', true, 'ttb_id', v_ttb, 'score', v_score, 'source', v_src);
end $$;
revoke all on function public.discover_label_match(uuid) from public, anon, authenticated;

-- Label facts now come from the matched label group (most approvals), detail facts from the label detail.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.discover_prefill_from_labels(uuid)'::regprocedure);
  d := replace(d, 'select d.id, d.product_name, d.cola_ttb_id ttb, d.cola_match_score sc, c.class_type, c.origin, c.permit_no, c.producer,',
                  'select d.id, d.product_name, d.cola_ttb_id ttb, d.cola_match_score sc, c.class_type, c.origin, c.permit_no, c.producer,');
  d := replace(d, 'left join public.discover_label_catalog c on c.ttb_id = d.cola_ttb_id',
                  'left join public.discover_product_label_facts c on c.discover_product_id = d.id');
  execute d;
end $$;
revoke all on function public.discover_prefill_from_labels(uuid) from public, anon, authenticated;

delete from public.discover_cola_detail_wanted where sent_at is null;
update public.discover_products set cola_ttb_id = null, cola_match_score = null, cola_matched_at = null where cola_ttb_id is not null;
