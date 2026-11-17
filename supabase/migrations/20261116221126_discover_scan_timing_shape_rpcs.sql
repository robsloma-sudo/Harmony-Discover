-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261116221126 "discover_scan_timing_shape_rpcs" was applied live but was never committed to the repo.

-- Called by the signed-in scanner. The person comes from their login, never from the request.
create or replace function public.discover_log_scan_timings(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n int; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 50 then raise exception 'bad rows'; end if;
  if not public.discover_rate_limit(uid, 'scan_timing', 60, 60) then return 0; end if;
  insert into public.discover_scan_timings(consumer_id, scan_session_id, track_id, named_by, ms_to_first_box, ms_to_text, ms_to_name, ms_to_confirm,
     brand, product, label_px, zoom, device, app_version)
  select uid, nullif(r->>'scan_session_id','')::uuid, left(r->>'track_id', 40), coalesce(nullif(r->>'named_by',''), 'none'),
         least(600000, (r->>'ms_to_first_box')::int), least(600000, (r->>'ms_to_text')::int), least(600000, (r->>'ms_to_name')::int), least(600000, (r->>'ms_to_confirm')::int),
         left(r->>'brand', 80), left(r->>'product', 80), (r->>'label_px')::int, (r->>'zoom')::numeric, left(r->>'device', 60), left(r->>'app_version', 20)
    from jsonb_array_elements(p_rows) r
   where coalesce(r->>'named_by','none') in ('barcode','letters','shape','ai_label','ai_frame','memory','none');
  get diagnostics n = row_count; return n;
end $$;

-- Shape fingerprints only for a product this person actually saved a sighting of.
create or replace function public.discover_log_shapes(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n int; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20 then raise exception 'bad rows'; end if;
  if not public.discover_rate_limit(uid, 'shape_log', 60, 60) then return 0; end if;
  insert into public.discover_shape_observations(consumer_id, discover_product_id, size_ml, container, aspect, shoulder_at, neck_width, base_width,
     outline, colour, label_px, box_px, zoom, rel_depth, distance_band, named_by)
  select uid, (r->>'discover_product_id')::uuid, (r->>'size_ml')::numeric, left(r->>'container', 20),
         (r->>'aspect')::numeric, (r->>'shoulder_at')::numeric, (r->>'neck_width')::numeric, (r->>'base_width')::numeric,
         case when jsonb_typeof(r->'outline') = 'array' and jsonb_array_length(r->'outline') = 32 then r->'outline' end,
         case when jsonb_typeof(r->'colour') = 'array' and jsonb_array_length(r->'colour') = 64 then r->'colour' end,
         (r->>'label_px')::int, (r->>'box_px')::int, (r->>'zoom')::numeric, (r->>'rel_depth')::numeric,
         public.discover_distance_band((r->>'label_px')::int, (r->>'zoom')::numeric), left(r->>'named_by', 20)
    from jsonb_array_elements(p_rows) r
   where (r->>'aspect')::numeric between 0.2 and 12
     and exists (select 1 from public.bottle_sightings s where s.consumer_id = uid and s.discover_product_id = (r->>'discover_product_id')::uuid);
  get diagnostics n = row_count; return n;
end $$;

revoke all on function public.discover_log_scan_timings(jsonb) from public, anon;
revoke all on function public.discover_log_shapes(jsonb) from public, anon;
grant execute on function public.discover_log_scan_timings(jsonb) to authenticated;
grant execute on function public.discover_log_shapes(jsonb) to authenticated;
