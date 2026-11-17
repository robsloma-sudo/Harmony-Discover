-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261115050708 "discover_match_line_ambiguity_and_unmerge" was applied live but was never committed to the repo.

-- A name that matches two different lines ("Straight Rye Cured Oak") is ambiguous: no line is assigned.
create or replace function public.discover_match_line(p_brand text, p_product text)
returns uuid language sql stable set search_path = public as $$
  with b as (select ' ' || discover_norm(p_brand) || ' ' as nb, ' ' || discover_norm(coalesce(p_product, '')) || ' ' as np),
  hits as (
    select distinct l.id
    from discover_brand_lines l, b,
         lateral (select discover_norm(x) as name from unnest(array[l.line_name] || coalesce(l.line_aliases, '{}')) x) n
    where exists (select 1 from unnest(array[l.brand_name] || coalesce(l.brand_aliases, '{}')) a
                  where length(discover_norm(a)) > 0 and b.nb like '% ' || discover_norm(a) || ' %')
      and length(n.name) > 0 and b.np like '% ' || n.name || ' %'
  )
  select case when (select count(*) from hits) = 1 then (select id from hits) end;
$$;

-- Undo one logged merge: the removed record comes back (same id, its facts as they were), with the sightings
-- that were read under its name.
create or replace function public.discover_unmerge_product(p_merge_id bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare m record; p jsonb; a jsonb;
begin
  select * into m from discover_product_merges where id = p_merge_id;
  if not found then raise exception 'merge not found'; end if;
  p := m.snapshot -> 'product';
  insert into discover_products select * from jsonb_populate_record(null::discover_products, p - 'discover_line_id' || jsonb_build_object('discover_line_id', null))
    on conflict (id) do nothing;
  update discover_products set discover_line_id = null where id = m.from_product_id;
  for a in select * from jsonb_array_elements(m.snapshot -> 'attributes') loop
    insert into discover_product_attributes select * from jsonb_populate_record(null::discover_product_attributes, a) on conflict do nothing;
  end loop;
  update bottle_sightings s set discover_product_id = m.from_product_id
   where s.discover_product_id = m.into_product_id
     and discover_norm(s.read_brand) = discover_norm(p ->> 'brand_name')
     and discover_norm(coalesce(s.read_product, '')) = discover_norm(coalesce(p ->> 'product_name', ''));
  return m.from_product_id;
end $$;
revoke all on function public.discover_unmerge_product(bigint) from public, anon, authenticated;

select public.discover_unmerge_product(id) from discover_product_merges
 where snapshot -> 'product' ->> 'product_name' = 'Straight Rye Cured Oak' and merged_at > now() - interval '1 hour';
