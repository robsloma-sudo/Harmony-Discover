-- DEVELOPMENT ONLY. Discover DEV project, after 0001-0011.
-- Menu reading with Claude vision (Rob, 9 Nov 2026). The reader (Edge Function discover-reader) claims a queued job,
-- reads the pages, and records the result here in ONE transaction: items, per-page results, observation quality,
-- job status. A failed read is retried with back-off, then marked failed. Raw observation evidence is never changed.
--
-- Quality mapping used by the retention rule (0005: "read well enough" needs min_ocr_confidence >= 0.9):
--   page legibility 'clear' = 0.95, 'partly_legible' = 0.70, 'illegible' = 0.20 (model-reported, documented, not calibrated).
--   all_pages_complete = every page is a menu page with the whole page visible.

alter table public.menu_observations add column if not exists venue_name_read text;
alter table public.menu_observations add column if not exists read_model text;
alter table public.menu_observations add column if not exists read_at timestamptz;

create table if not exists public.observation_items (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.menu_observations(id) on delete cascade,
  consumer_id uuid not null references auth.users(id) on delete cascade,
  page_index integer not null check (page_index >= 0),
  position integer not null check (position >= 0),
  section text,
  name text not null check (length(name) between 1 and 200),
  description text check (length(description) <= 600),
  price_text text check (length(price_text) <= 40),
  beverage_category text not null check (beverage_category in ('cocktail','wine','beer','spirits','non_alcoholic','food','other')),
  listed_ingredients text[] not null default '{}',
  evidence_state text not null default 'menu_observed' check (evidence_state in ('menu_observed')),   -- as printed; never canonical
  -- Second-reader slot (Rob, 9 Nov 2026: "Claude now, Vision later"): null = not cross-checked yet; true/false once an
  -- independent OCR transcript (e.g. Google Cloud Vision) confirms or fails to confirm the name and price.
  text_verified boolean,
  created_at timestamptz not null default now(),
  unique (observation_id, page_index, position)
);
create index if not exists observation_items_observation_idx on public.observation_items(observation_id);
create index if not exists observation_items_consumer_idx on public.observation_items(consumer_id);
alter table public.observation_items enable row level security;
create policy "consumer reads own items" on public.observation_items for select to authenticated using ((select auth.uid()) = consumer_id);

-- Records a successful read atomically. p_pages: [{asset_id, page_index, is_menu, legibility, complete_page_visible, item_count}]
-- p_items: [{page_index, position, section, name, description, price_text, beverage_category, listed_ingredients}]
create or replace function public.discover_complete_reading(p_job uuid, p_observation uuid, p_pages jsonb, p_items jsonb,
                                                            p_venue_name text, p_model text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_consumer uuid; v_items int; v_min numeric; v_complete boolean;
begin
  select consumer_id into v_consumer from public.menu_observations where id = p_observation for update;
  if v_consumer is null then raise exception 'observation_not_found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_pages) <> 'array' or jsonb_array_length(p_pages) = 0 then raise exception 'no_pages' using errcode = '22023'; end if;

  delete from public.observation_items where observation_id = p_observation;          -- idempotent on retry
  insert into public.observation_items(observation_id, consumer_id, page_index, position, section, name, description, price_text,
                                       beverage_category, listed_ingredients, text_verified)
  select p_observation, v_consumer, (i->>'page_index')::int, (i->>'position')::int, nullif(i->>'section',''), i->>'name',
         nullif(i->>'description',''), nullif(i->>'price_text',''), i->>'beverage_category',
         coalesce(array(select jsonb_array_elements_text(coalesce(i->'listed_ingredients','[]'))), '{}'),
         (i->>'text_verified')::boolean
  from jsonb_array_elements(coalesce(p_items, '[]')) i;
  get diagnostics v_items = row_count;

  insert into public.observation_extractions(observation_id, asset_id, extraction_status, ocr_provider, ocr_payload)
  select p_observation, (pg->>'asset_id')::uuid, 'extracted', p_model, pg
  from jsonb_array_elements(p_pages) pg
  on conflict (asset_id) do update set extraction_status = 'extracted', ocr_provider = excluded.ocr_provider, ocr_payload = excluded.ocr_payload;

  select min(case pg->>'legibility' when 'clear' then 0.95 when 'partly_legible' then 0.70 else 0.20 end),
         bool_and(coalesce((pg->>'is_menu')::boolean, false) and coalesce((pg->>'complete_page_visible')::boolean, false))
    into v_min, v_complete from jsonb_array_elements(p_pages) pg;

  update public.menu_observations set status = 'ready_for_review', min_ocr_confidence = v_min, all_pages_complete = v_complete,
         structured_menu_saved = v_items > 0, venue_name_read = nullif(left(p_venue_name, 180), ''), read_model = p_model,
         read_at = now(), updated_at = now()
  where id = p_observation;
  -- Evaluated on the updated row: "read well enough" starts the retention clock (0005) once, and never resets it.
  update public.menu_observations o set qualified_at = coalesce(o.qualified_at, now())
  where o.id = p_observation and public.discover_observation_qualifies(o);
  update public.observation_assets set processing_status = 'processed' where observation_id = p_observation and deleted_at is null;
  update public.observation_jobs set status = 'complete', locked_at = null, last_error = null, updated_at = now() where id = p_job;
  return jsonb_build_object('items', v_items, 'min_confidence', v_min, 'all_pages_complete', v_complete);
end $$;

-- Records a failed attempt: retry with back-off (2, 4, 8 … minutes) until max_attempts, or fail now if permanent.
create or replace function public.discover_fail_reading(p_job uuid, p_error text, p_permanent boolean default false) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare j public.observation_jobs; v_status text;
begin
  select * into j from public.observation_jobs where id = p_job for update;
  if not found then return 'not_found'; end if;
  v_status := case when p_permanent or j.attempts >= j.max_attempts then 'failed' else 'retry' end;
  update public.observation_jobs set status = v_status, last_error = left(p_error, 300), locked_at = null, updated_at = now(),
         available_at = now() + make_interval(mins => power(2, least(j.attempts, 6))::int)
  where id = p_job;
  if v_status = 'failed' then
    update public.menu_observations set status = 'failed', updated_at = now() where id = j.observation_id;
  end if;
  return v_status;
end $$;

-- What the owner sees for one observation: status and items (the API checks ownership first).
create or replace function public.discover_observation_result(p_subject uuid, p_observation uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when o.id is null then null else jsonb_build_object(
    'id', o.id, 'status', o.status, 'pages', (select count(*) from public.observation_assets a where a.observation_id = o.id),
    'venue_name_read', o.venue_name_read, 'read_at', o.read_at,
    'quality', jsonb_build_object('all_pages_complete', o.all_pages_complete, 'min_confidence', o.min_ocr_confidence),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'page', i.page_index, 'section', i.section, 'name', i.name,
        'description', i.description, 'price', i.price_text, 'category', i.beverage_category, 'listed_ingredients', i.listed_ingredients,
        'evidence', i.evidence_state, 'text_verified', i.text_verified) order by i.page_index, i.position) from public.observation_items i where i.observation_id = o.id), '[]'))
  end
  from (select 1) one left join public.menu_observations o on o.id = p_observation and o.consumer_id = p_subject;
$$;

revoke all on function public.discover_complete_reading(uuid, uuid, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.discover_fail_reading(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.discover_observation_result(uuid, uuid) from public, anon, authenticated;
grant execute on function public.discover_complete_reading(uuid, uuid, jsonb, jsonb, text, text) to service_role;
grant execute on function public.discover_fail_reading(uuid, text, boolean) to service_role;
grant execute on function public.discover_observation_result(uuid, uuid) to service_role;