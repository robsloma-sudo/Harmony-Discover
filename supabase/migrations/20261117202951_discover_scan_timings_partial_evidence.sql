-- Partial evidence metrics (Rob, 17 Nov 2026): time to name, share of partly hidden bottles named, wrong-name rate.
-- partial: the label was partly hidden or cut off at some read; guess_source: where the first "Probably …" came
-- from (the phone's quick guess or partial evidence); verify_calls / verify_verdict: targeted checks of the label.
alter table public.discover_scan_timings
  add column if not exists partial boolean,
  add column if not exists guess_source text,
  add column if not exists verify_calls integer,
  add column if not exists verify_verdict text;
alter table public.discover_scan_timings drop constraint if exists discover_scan_timings_named_by_check;
alter table public.discover_scan_timings add constraint discover_scan_timings_named_by_check
  check (named_by = any (array['barcode', 'letters', 'partial', 'shape', 'ai_label', 'ai_frame', 'memory', 'none']));

create or replace function public.discover_log_scan_timings(p_rows jsonb)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare n int; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 50 then raise exception 'bad rows'; end if;
  if not public.discover_rate_limit(uid, 'scan_timing', 60, 60) then return 0; end if;
  -- (LEAST ignores NULL, so a missing time must stay NULL, not become the cap.)
  insert into public.discover_scan_timings(consumer_id, scan_session_id, track_id, named_by, ms_to_first_box, ms_to_text, ms_to_name, ms_to_confirm,
     brand, product, label_px, zoom, device, app_version, guess_brand, guess_agreed, ocr_ms, ocr_words,
     partial, guess_source, verify_calls, verify_verdict)
  select uid, nullif(r->>'scan_session_id','')::uuid, left(r->>'track_id', 40), coalesce(nullif(r->>'named_by',''), 'none'),
         case when (r->>'ms_to_first_box') is null then null else least(600000, (r->>'ms_to_first_box')::int) end,
         case when (r->>'ms_to_text') is null then null else least(600000, (r->>'ms_to_text')::int) end,
         case when (r->>'ms_to_name') is null then null else least(600000, (r->>'ms_to_name')::int) end,
         case when (r->>'ms_to_confirm') is null then null else least(600000, (r->>'ms_to_confirm')::int) end,
         left(r->>'brand', 80), left(r->>'product', 80), (r->>'label_px')::int, (r->>'zoom')::numeric, left(r->>'device', 60), left(r->>'app_version', 20),
         left(r->>'guess_brand', 80), (r->>'guess_agreed')::boolean,
         case when (r->>'ocr_ms') is null then null else least(600000, (r->>'ocr_ms')::int) end,
         case when jsonb_typeof(r->'ocr_words') = 'array' then (select array_agg(left(w, 40)) from (select jsonb_array_elements_text(r->'ocr_words') w limit 6) x) end,
         (r->>'partial')::boolean,
         case when r->>'guess_source' in ('letters', 'partial') then r->>'guess_source' end,
         case when (r->>'verify_calls') is null then null else least(10, greatest(0, (r->>'verify_calls')::int)) end,
         case when r->>'verify_verdict' in ('match', 'none', 'error') then r->>'verify_verdict' end
    from jsonb_array_elements(p_rows) r
   where coalesce(r->>'named_by','none') in ('barcode','letters','partial','shape','ai_label','ai_frame','memory','none');
  get diagnostics n = row_count; return n;
end $function$;
revoke all on function public.discover_log_scan_timings(jsonb) from public, anon;
grant execute on function public.discover_log_scan_timings(jsonb) to authenticated;
