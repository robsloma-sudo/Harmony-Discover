-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261115050645 "discover_merge_duplicates_word_order" was applied live but was never committed to the repo.

-- Word order does not matter ("US*1 Limited Release ..." = "Limited Release ... US*1"); names made only of
-- drink-kind words ("American Whiskey" vs "Kentucky Straight Bourbon") are never merged with each other.
create or replace function public.discover_product_core_key(p_product text)
returns text language sql immutable set search_path = public as $$
  select coalesce(string_agg(distinct w, ' ' order by w), '')
  from unnest(string_to_array(discover_product_core(p_product), ' ')) w where w <> '';
$$;
create or replace function public.discover_merge_duplicates()
returns integer language plpgsql security definer set search_path = public as $$
declare d record; n integer := 0;
begin
  for d in
    select p.id, coalesce(
      (select k.id from discover_products k join discover_brand_lines l on l.id = k.discover_line_id
        where k.discover_line_id = p.discover_line_id and k.status = 'identified' and l.release_pattern = 'continuous'
          and coalesce(k.identity_payload #>> '{release,key}', 'standard') = 'standard' order by k.created_at limit 1),
      (select k.id from discover_products k where k.discover_line_id = p.discover_line_id and k.status = 'candidate'
        order by (select count(*) from discover_product_attributes a where a.discover_product_id = k.id) desc, k.created_at limit 1)) as keep_id
    from discover_products p where p.status = 'candidate' and p.discover_line_id is not null
  loop
    if d.keep_id is not null and d.keep_id <> d.id and exists (select 1 from discover_products where id = d.id) then
      perform discover_merge_product(d.id, d.keep_id, 'same line'); n := n + 1;
    end if;
  end loop;
  for d in
    select p.id, first_value(p.id) over w as keep_id, row_number() over w as rn
    from discover_products p
    where p.status = 'candidate' and p.discover_line_id is null
      and (discover_product_core_key(p.product_name) <> '' or nullif(btrim(coalesce(p.product_name, '')), '') is null)
    window w as (partition by discover_norm(p.brand_name), discover_product_core_key(p.product_name),
                   (discover_product_core_key(p.product_name) = '')
                 order by (select count(*) from discover_product_attributes a where a.discover_product_id = p.id) desc, p.created_at)
  loop
    if d.rn > 1 then perform discover_merge_product(d.id, d.keep_id, 'same name'); n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.discover_merge_duplicates() from public, anon, authenticated;
