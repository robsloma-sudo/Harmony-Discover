-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116204621 "discover_label_family_check" was applied live but was never committed to the repo.

create or replace function public.discover_label_family(p_class text) returns text language sql immutable as $$
  select case when p_class is null then null
              when p_class ~* '(malt bev|beer|\male\M|lager|stout|porter|cereal bev)' then 'beer'
              when p_class ~* '(brandy|cognac|armagnac|pisco|grappa)' then 'spirits'
              when p_class ~* '(wine|vermouth|sake|cider|mead|champagne|sparkling|port\M|sherry)' then 'wine'
              else 'spirits' end
$$;
create or replace function public.discover_kind_family(p_kind text) returns text language sql immutable as $$
  select case when p_kind in ('beer','non_alcoholic_beer') then 'beer'
              when p_kind in ('wine','sparkling','vermouth','cider') then 'wine'
              when p_kind in ('other','non_alcoholic') or p_kind is null then null
              else 'spirits' end
$$;
create or replace function public.discover_class_label(p text) returns text language sql immutable as $$
  select case when c is null or c ~* '(other|speciali|specialt|proprietar|cocktail|diluted|^whisky$|^vodka$|^gin$|^rum$|^brandy$|^tequila$|^beer$)' then null
              else initcap(c) end
  from (select nullif(trim(regexp_replace(regexp_replace(lower(coalesce(p,'')), '\s+(fb|usb|us)$', ''), '\s*\(cont\.\)', '')), '') c) x
$$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.discover_label_match(uuid)'::regprocedure);
  d := replace(d, 'select id, brand_name, product_name, phg_match_product_id into d from public.discover_products where id = p_product;',
                  'select id, brand_name, product_name, phg_match_product_id, product_class into d from public.discover_products where id = p_product;');
  d := replace(d, '  if ok then
    -- What most',
                  '  if ok then
    select mode() within group (order by c.class_type) into v_best from public.discover_label_catalog c
     where lower(c.brand) = lower(top.brand) and c.product is not distinct from top.product;
    -- a beer label is not a spirit (and so on): the kinds must agree when both are known
    if public.discover_kind_family(d.product_class) is not null and public.discover_label_family(v_best) is not null
       and public.discover_kind_family(d.product_class) <> public.discover_label_family(v_best) then
      ok := false; v_best := top.brand || '' / '' || coalesce(top.product, '''') || '' (other kind of drink)'';
    end if;
  end if;
  if ok then
    -- What most');
  execute d;
end $$;
revoke all on function public.discover_label_match(uuid) from public, anon, authenticated;
