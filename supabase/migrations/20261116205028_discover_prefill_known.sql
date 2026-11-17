-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116205028 "discover_prefill_known" was applied live but was never committed to the repo.

-- One call for the scanner: link to Harmony's catalogue, copy Harmony facts, match the US label, copy label facts.
-- Empty fields only; quick when the product was already checked.
create or replace function public.discover_prefill_known(p_product uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d record; v_link jsonb; v_phg jsonb; v_label jsonb; v_lf jsonb;
begin
  select id, phg_link_method, phg_linked_at, cola_ttb_id, label_checked_at into d from public.discover_products where id = p_product;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_product'); end if;
  if coalesce(d.phg_link_method, '') <> 'manual' and (d.phg_linked_at is null or d.phg_linked_at < now() - interval '1 day') then
    v_link := public.discover_link_phg(p_product);
  end if;
  v_phg := public.discover_prefill_from_phg(p_product);
  if d.cola_ttb_id is null and (d.label_checked_at is null or d.label_checked_at < now() - interval '1 day') then
    v_label := public.discover_label_match(p_product);
  end if;
  v_lf := public.discover_prefill_from_labels(p_product);
  return jsonb_build_object('ok', true, 'link', v_link, 'harmony', v_phg, 'label', v_label, 'label_facts', v_lf);
end $$;
revoke all on function public.discover_prefill_known(uuid) from public, anon, authenticated;
