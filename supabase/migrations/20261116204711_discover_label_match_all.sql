-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116204711 "discover_label_match_all" was applied live but was never committed to the repo.

alter table public.discover_products add column if not exists label_checked_at timestamptz;
do $$
declare d text;
begin
  d := pg_get_functiondef('public.discover_label_match(uuid)'::regprocedure);
  -- remember when a product was last checked (matched or not), so the sweep does not repeat it every run
  d := replace(d, '  if not found then return jsonb_build_object(''ok'', false, ''reason'', ''no_product''); end if;',
                  '  if not found then return jsonb_build_object(''ok'', false, ''reason'', ''no_product''); end if;
  update public.discover_products set label_checked_at = now() where id = p_product;');
  execute d;
end $$;
revoke all on function public.discover_label_match(uuid) from public, anon, authenticated;

create or replace function public.discover_label_match_all(p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; m int := 0;
begin
  for r in select id from public.discover_products
            where cola_ttb_id is null and (label_checked_at is null or label_checked_at < now() - interval '7 days'
                  or (phg_linked_at is not null and phg_linked_at > label_checked_at))
            order by label_checked_at nulls first, created_at desc limit greatest(1, least(p_limit, 500)) loop
    n := n + 1;
    if (public.discover_label_match(r.id)->>'ok')::boolean then m := m + 1; end if;
  end loop;
  return jsonb_build_object('checked', n, 'matched', m, 'prefill', public.discover_prefill_from_labels(null));
end $$;
revoke all on function public.discover_label_match_all(int) from public, anon, authenticated;
update public.discover_products set label_checked_at = coalesce(cola_matched_at, now()) where label_checked_at is null;

select cron.unschedule('discover-link-phg-30min');
select cron.schedule('discover-link-phg-30min', '*/30 * * * *', $c$ select public.discover_link_phg(); select public.discover_prefill_from_phg(); select public.discover_label_match_all(100); $c$);
