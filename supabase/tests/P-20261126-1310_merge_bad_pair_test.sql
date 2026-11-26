-- P-20261126-1310 part 1: SELF-ROLLING-BACK proof for 20261126140000_discover_merge_package_clash.sql (Discover DEV).
-- Loads the NEW merge commands, runs the real job, then raises an exception with the JSON report, so
-- everything (new commands, merges, test trigger) is rolled back. Changes nothing. Run in the SQL editor.
do $dry$
declare r jsonb; n int; badinto2 int; bad uuid; badinto uuid;
begin
execute $mig$create table if not exists public.discover_merge_skips (
  from_product_id uuid not null,
  into_product_id uuid not null,
  reason text,
  tries integer not null default 1,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  last_error_state text,
  last_error text,
  primary key (from_product_id, into_product_id)
)$mig$;
execute $mig$alter table public.discover_merge_skips enable row level security$mig$;
execute $mig$comment on table public.discover_merge_skips is
  'Duplicate pairs discover_merge_duplicates could not merge (one row per pair, last error). Server-side only; no policies.'$mig$;
execute $mig$create or replace function public.discover_merge_product(p_from uuid, p_into uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a record; pk record; sp record; v_kp uuid; v_phg uuid;
begin
  if p_from = p_into then return; end if;
  if not exists (select 1 from discover_products where id = p_into) then
    raise exception 'merge target % does not exist', p_into;
  end if;
  insert into discover_product_merges(from_product_id, into_product_id, reason, snapshot)
  select p_from, p_into, p_reason, jsonb_build_object('product', to_jsonb(p),
    'attributes', coalesce((select jsonb_agg(to_jsonb(x)) from discover_product_attributes x where x.discover_product_id = p_from), '[]'::jsonb),
    'packages', coalesce((select jsonb_agg(to_jsonb(x)) from discover_product_packages x where x.discover_product_id = p_from), '[]'::jsonb),
    'label_facts', coalesce((select jsonb_agg(to_jsonb(x)) from discover_product_label_facts x where x.discover_product_id = p_from), '[]'::jsonb),
    'shape_profiles', coalesce((select jsonb_agg(to_jsonb(x)) from discover_shape_profiles x where x.discover_product_id = p_from), '[]'::jsonb))
  from discover_products p where p.id = p_from;
  if not found then return; end if;

  update discover_product_evidence set discover_product_id = p_into where discover_product_id = p_from;
  -- Facts: keep the more confident value for each kind of fact.
  for a in select * from discover_product_attributes where discover_product_id = p_from loop
    if exists (select 1 from discover_product_attributes t where t.discover_product_id = p_into and t.attribute_code = a.attribute_code) then
      update discover_product_attributes t set value_text = a.value_text, value_numeric = a.value_numeric, value_json = a.value_json,
             unit = a.unit, state = a.state, confidence = a.confidence, evidence_id = a.evidence_id, updated_at = now()
       where t.discover_product_id = p_into and t.attribute_code = a.attribute_code
         and coalesce(a.confidence, 0) > coalesce(t.confidence, 0);
      delete from discover_product_attributes where id = a.id;
    else
      update discover_product_attributes set discover_product_id = p_into where id = a.id;
    end if;
  end loop;

  -- Packages: combine rows with the same label approval, move the rest.
  for pk in select * from discover_product_packages where discover_product_id = p_from loop
    v_kp := null;
    if pk.label_approval_id is not null then
      select id into v_kp from discover_product_packages
       where discover_product_id = p_into and label_approval_id = pk.label_approval_id limit 1;
    end if;
    if v_kp is not null then
      delete from discover_product_packages where id = pk.id;   -- first, so its phg_package_id is free to carry over
      update discover_product_packages k set
             phg_package_id     = coalesce(k.phg_package_id, pk.phg_package_id),
             package_size_ml    = coalesce(k.package_size_ml, pk.package_size_ml),
             abv_percent        = coalesce(k.abv_percent, pk.abv_percent),
             package_type       = coalesce(nullif(btrim(k.package_type), ''), pk.package_type),
             container_material = coalesce(nullif(btrim(k.container_material), ''), pk.container_material),
             upc_gtin           = coalesce(nullif(btrim(k.upc_gtin), ''), pk.upc_gtin),
             ean                = coalesce(nullif(btrim(k.ean), ''), pk.ean),
             package_payload    = coalesce(pk.package_payload, '{}'::jsonb) || coalesce(k.package_payload, '{}'::jsonb),
             created_at         = least(k.created_at, pk.created_at),
             updated_at         = now()
       where k.id = v_kp;
    else
      update discover_product_packages set discover_product_id = p_into where id = pk.id;
    end if;
  end loop;

  -- Label facts (one row per bottle): move when the kept bottle has none; otherwise the kept row stays and the
  -- duplicate's row is kept in the merge snapshot (mixing two label records field by field would be wrong).
  if not exists (select 1 from discover_product_label_facts where discover_product_id = p_into) then
    update discover_product_label_facts set discover_product_id = p_into where discover_product_id = p_from;
  end if;

  -- Bottle shapes: add up matching profiles, move the rest; move raw observations.
  for sp in select * from discover_shape_profiles where discover_product_id = p_from loop
    if exists (select 1 from discover_shape_profiles k where k.discover_product_id = p_into and k.size_ml is not distinct from sp.size_ml
                 and k.container is not distinct from sp.container and k.distance_band is not distinct from sp.distance_band) then
      update discover_shape_profiles k set
             observations = coalesce(k.observations, 0) + coalesce(sp.observations, 0),
             updated_at  = greatest(k.updated_at, sp.updated_at)
       where k.discover_product_id = p_into and k.size_ml is not distinct from sp.size_ml
         and k.container is not distinct from sp.container and k.distance_band is not distinct from sp.distance_band;
      delete from discover_shape_profiles s where s.discover_product_id = p_from and s.size_ml is not distinct from sp.size_ml
         and s.container is not distinct from sp.container and s.distance_band is not distinct from sp.distance_band;
    else
      update discover_shape_profiles s set discover_product_id = p_into where s.discover_product_id = p_from
         and s.size_ml is not distinct from sp.size_ml and s.container is not distinct from sp.container
         and s.distance_band is not distinct from sp.distance_band;
    end if;
  end loop;
  update discover_shape_observations set discover_product_id = p_into where discover_product_id = p_from;
  update discover_cola_detail_wanted set discover_product_id = p_into where discover_product_id = p_from;
  update discover_scan_timings set discover_product_id = p_into where discover_product_id = p_from;

  update bottle_sightings set discover_product_id = p_into where discover_product_id = p_from;
  update discover_phg_export_queue set discover_product_id = p_into where discover_product_id = p_from;
  delete from discover_enrichment_jobs j where j.discover_product_id = p_from and j.status in ('queued','processing','retry')
    and exists (select 1 from discover_enrichment_jobs k where k.discover_product_id = p_into and k.job_type = j.job_type and k.status in ('queued','processing','retry'));
  update discover_enrichment_jobs set discover_product_id = p_into where discover_product_id = p_from;
  insert into discover_product_search_usage (discover_product_id, searches, research_runs, last_research_at)
  select p_into, searches, research_runs, last_research_at from discover_product_search_usage where discover_product_id = p_from
  on conflict (discover_product_id) do update set searches = discover_product_search_usage.searches + excluded.searches,
    research_runs = discover_product_search_usage.research_runs + excluded.research_runs,
    last_research_at = greatest(discover_product_search_usage.last_research_at, excluded.last_research_at);
  update discover_research_outcomes set discover_product_id = p_into where discover_product_id = p_from;

  -- Harmony link: carry it over when the kept bottle has none (cleared on the duplicate first: it is unique).
  select f.phg_product_id into v_phg from discover_products f, discover_products k
   where f.id = p_from and k.id = p_into and f.phg_product_id is not null and k.phg_product_id is null;
  if v_phg is not null then
    update discover_products set phg_product_id = null where id = p_from;
  end if;
  update discover_products t set first_seen_at = least(t.first_seen_at, f.first_seen_at), last_seen_at = greatest(t.last_seen_at, f.last_seen_at),
         upc_gtin = coalesce(t.upc_gtin, f.upc_gtin), ean = coalesce(t.ean, f.ean),
         phg_product_id = coalesce(t.phg_product_id, v_phg), updated_at = now()
    from discover_products f where t.id = p_into and f.id = p_from;
  delete from discover_products where id = p_from;
end $$$mig$;
execute $mig$create or replace function public.discover_merge_try(p_from uuid, p_into uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_state text; v_msg text;
begin
  begin
    perform discover_merge_product(p_from, p_into, p_reason);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    insert into discover_merge_skips (from_product_id, into_product_id, reason, last_error_state, last_error)
    values (p_from, p_into, p_reason, v_state, left(v_msg, 500))
    on conflict (from_product_id, into_product_id) do update set tries = discover_merge_skips.tries + 1,
      last_failed_at = now(), reason = excluded.reason, last_error_state = excluded.last_error_state, last_error = excluded.last_error;
    raise warning 'discover_merge_duplicates skipped % -> %: % %', p_from, p_into, v_state, v_msg;
    return false;
  end;
  delete from discover_merge_skips where from_product_id = p_from and into_product_id = p_into;
  return true;
end $$$mig$;
execute $mig$revoke all on function public.discover_merge_try(uuid, uuid, text) from public, anon, authenticated$mig$;
execute $mig$create or replace function public.discover_merge_duplicates()
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
      if discover_merge_try(d.id, d.keep_id, 'same line') then n := n + 1; end if;
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
    if d.rn > 1 and exists (select 1 from discover_products where id = d.id) then
      if discover_merge_try(d.id, d.keep_id, 'same name') then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$$mig$;
execute $q$create temp table _pairs on commit drop as
with s1 as (
 select p.id, coalesce(
      (select k.id from discover_products k join discover_brand_lines l on l.id = k.discover_line_id
        where k.discover_line_id = p.discover_line_id and k.status = 'identified' and l.release_pattern = 'continuous'
          and coalesce(k.identity_payload #>> '{release,key}', 'standard') = 'standard' order by k.created_at limit 1),
      (select k.id from discover_products k where k.discover_line_id = p.discover_line_id and k.status = 'candidate'
        order by (select count(*) from discover_product_attributes a where a.discover_product_id = k.id) desc, k.created_at limit 1)) as keep_id, 'same line'::text r
    from discover_products p where p.status = 'candidate' and p.discover_line_id is not null),
s2 as (select id, keep_id, 'same name'::text r from (select p.id, first_value(p.id) over w as keep_id, row_number() over w as rn
    from discover_products p
    where p.status = 'candidate' and p.discover_line_id is null
      and (discover_product_core_key(p.product_name) <> '' or nullif(btrim(coalesce(p.product_name, '')), '') is null)
    window w as (partition by discover_norm(p.brand_name), discover_product_core_key(p.product_name),
                   (discover_product_core_key(p.product_name) = '')
                 order by (select count(*) from discover_product_attributes a where a.discover_product_id = p.id) desc, p.created_at)) z where rn>1)
select pr.id dup_id, pr.keep_id, pr.r, coalesce(f.brand_name||' / '||f.product_name,'(blank name)') dup_name, coalesce(k.brand_name||' / '||k.product_name,'(blank name)') keep_name
from (select * from s1 where keep_id is not null and keep_id<>id union all select * from s2) pr join discover_products f on f.id=pr.id join discover_products k on k.id=pr.keep_id$q$;
execute $q$create temp table _pk_before on commit drop as
 select x.*, p.dup_id is not null as from_dup from discover_product_packages x left join _pairs p on p.dup_id=x.discover_product_id
 where x.discover_product_id in (select dup_id from _pairs union select keep_id from _pairs)$q$;
execute $q$create temp table _counts_before on commit drop as select
 (select count(*) from discover_product_label_facts) lf, (select count(*) from discover_shape_observations) so,
 (select count(*) from discover_cola_detail_wanted) cw, (select count(*) from discover_product_merges) mg,
 (select count(*) from discover_products where phg_product_id is not null) phg, (select count(*) from discover_products) prods,
 (select count(*) from bottle_sightings where discover_product_id is not null) bs$q$;
select dup_id, keep_id into bad, badinto from _pairs where dup_name like 'Jack Daniel''s / Single Barrel Special%' limit 1;
execute format($t$create function public._tmp_block_merge() returns trigger language plpgsql as $f$begin if old.id = %L then raise exception 'deliberate test failure'; end if; return old; end$f$$t$, bad);
execute 'create trigger _tmp_block_merge before delete on public.discover_products for each row execute function public._tmp_block_merge()';
n := discover_merge_duplicates();
r := jsonb_build_object('first_run_skip_tries', (select tries from discover_merge_skips where from_product_id=bad));
badinto2 := discover_merge_duplicates();
select jsonb_build_object('merged', n, 'pairs_total', (select count(*) from _pairs),
  'bad_pair_still_there', (select exists (select 1 from discover_products where id=bad) and exists (select 1 from discover_product_packages where discover_product_id=bad)),
  'bad_pair_partial_changes_rolled_back', not exists (select 1 from discover_product_merges where from_product_id=bad and merged_at=now()),
  'skip_rows', (select jsonb_agg(jsonb_build_object('is_bad_pair', from_product_id=bad and into_product_id=badinto, 'tries', tries, 'error', last_error)) from discover_merge_skips),
  'others_gone', (select count(*) from _pairs p where p.dup_id<>bad and not exists (select 1 from discover_products where id=p.dup_id)),
  'second_run_merged', badinto2, 'first', r,
  'tries_after_second_run', (select tries from discover_merge_skips where from_product_id=bad)) into r;
raise exception 'BADPAIR %', r;

end $dry$;