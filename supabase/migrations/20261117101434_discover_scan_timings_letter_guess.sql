-- Exported verbatim from Discover DEV (lqqmwqrffelgnbngrkep) migration history on 2026-11-17.
-- Version 20261117101434 "discover_scan_timings_letter_guess" was applied live but was never committed to the repo.
alter table public.discover_scan_timings add column if not exists guess_brand text, add column if not exists guess_agreed boolean, add column if not exists ocr_ms integer, add column if not exists ocr_words text[];
CREATE OR REPLACE FUNCTION public.discover_log_scan_timings(p_rows jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare n int; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 50 then raise exception 'bad rows'; end if;
  if not public.discover_rate_limit(uid, 'scan_timing', 60, 60) then return 0; end if;
  insert into public.discover_scan_timings(consumer_id, scan_session_id, track_id, named_by, ms_to_first_box, ms_to_text, ms_to_name, ms_to_confirm,
     brand, product, label_px, zoom, device, app_version, guess_brand, guess_agreed, ocr_ms, ocr_words)
  select uid, nullif(r->>'scan_session_id','')::uuid, left(r->>'track_id', 40), coalesce(nullif(r->>'named_by',''), 'none'),
         least(600000, (r->>'ms_to_first_box')::int), least(600000, (r->>'ms_to_text')::int), least(600000, (r->>'ms_to_name')::int), least(600000, (r->>'ms_to_confirm')::int),
         left(r->>'brand', 80), left(r->>'product', 80), (r->>'label_px')::int, (r->>'zoom')::numeric, left(r->>'device', 60), left(r->>'app_version', 20),
         left(r->>'guess_brand', 80), (r->>'guess_agreed')::boolean, least(600000, (r->>'ocr_ms')::int),
         case when jsonb_typeof(r->'ocr_words') = 'array' then (select array_agg(left(w, 40)) from (select jsonb_array_elements_text(r->'ocr_words') w limit 6) x) end
    from jsonb_array_elements(p_rows) r
   where coalesce(r->>'named_by','none') in ('barcode','letters','shape','ai_label','ai_frame','memory','none');
  get diagnostics n = row_count; return n;
end $function$;
revoke all on function public.discover_log_scan_timings(jsonb) from public, anon;
grant execute on function public.discover_log_scan_timings(jsonb) to authenticated;
