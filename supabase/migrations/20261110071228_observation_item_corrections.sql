create table if not exists public.observation_item_corrections (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.menu_observations(id) on delete cascade,
  item_id uuid not null references public.observation_items(id) on delete cascade,
  consumer_id uuid not null references auth.users(id) on delete cascade,
  before_values jsonb not null,
  after_values jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists observation_item_corrections_item_created_idx
  on public.observation_item_corrections(item_id, created_at desc);
alter table public.observation_item_corrections enable row level security;
revoke all on public.observation_item_corrections from anon, authenticated;
grant select, insert on public.observation_item_corrections to service_role;

create or replace function public.discover_correct_observation_item(
  p_subject uuid, p_observation uuid, p_item uuid, p_changes jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  old_row public.observation_items%rowtype;
  new_row public.observation_items%rowtype;
  before_json jsonb := '{}'::jsonb;
  after_json jsonb := '{}'::jsonb;
  k text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(p_changes) as x(key)
                where key not in ('name','section','description','price_text','beverage_category')) then
    raise exception 'invalid_correction_fields' using errcode = '22023';
  end if;
  select i.* into old_row
  from public.observation_items i
  join public.menu_observations o on o.id = i.observation_id and o.consumer_id = p_subject
  where i.id = p_item and i.observation_id = p_observation and i.consumer_id = p_subject
  for update;
  if not found then raise exception 'observation_item_not_found' using errcode = 'P0002'; end if;
  if p_changes ? 'name' and (jsonb_typeof(p_changes->'name') <> 'string' or length(trim(p_changes->>'name')) not between 1 and 200) then raise exception 'invalid_name' using errcode='22023'; end if;
  if p_changes ? 'section' and p_changes->'section' <> 'null'::jsonb and (jsonb_typeof(p_changes->'section') <> 'string' or length(p_changes->>'section') > 80) then raise exception 'invalid_section' using errcode='22023'; end if;
  if p_changes ? 'description' and p_changes->'description' <> 'null'::jsonb and (jsonb_typeof(p_changes->'description') <> 'string' or length(p_changes->>'description') > 600) then raise exception 'invalid_description' using errcode='22023'; end if;
  if p_changes ? 'price_text' and p_changes->'price_text' <> 'null'::jsonb and (jsonb_typeof(p_changes->'price_text') <> 'string' or length(p_changes->>'price_text') > 40) then raise exception 'invalid_price' using errcode='22023'; end if;
  if p_changes ? 'beverage_category' and (jsonb_typeof(p_changes->'beverage_category') <> 'string' or p_changes->>'beverage_category' not in ('cocktail','wine','beer','spirits','non_alcoholic','food','other')) then raise exception 'invalid_category' using errcode='22023'; end if;
  foreach k in array array['name','section','description','price_text','beverage_category'] loop
    if p_changes ? k then
      before_json := before_json || jsonb_build_object(k, to_jsonb(case k when 'name' then old_row.name when 'section' then old_row.section when 'description' then old_row.description when 'price_text' then old_row.price_text when 'beverage_category' then old_row.beverage_category end));
      after_json := after_json || jsonb_build_object(k, p_changes->k);
    end if;
  end loop;
  update public.observation_items set
    name = case when p_changes ? 'name' then trim(p_changes->>'name') else name end,
    section = case when p_changes ? 'section' then p_changes->>'section' else section end,
    description = case when p_changes ? 'description' then p_changes->>'description' else description end,
    price_text = case when p_changes ? 'price_text' then p_changes->>'price_text' else price_text end,
    beverage_category = case when p_changes ? 'beverage_category' then p_changes->>'beverage_category' else beverage_category end
  where id = p_item returning * into new_row;
  insert into public.observation_item_corrections(observation_id,item_id,consumer_id,before_values,after_values)
  values (p_observation,p_item,p_subject,before_json,after_json);
  return jsonb_build_object('id',new_row.id,'page',new_row.page_index,'section',new_row.section,
    'name',new_row.name,'description',new_row.description,'price',new_row.price_text,
    'category',new_row.beverage_category,'listed_ingredients',new_row.listed_ingredients,
    'evidence',new_row.evidence_state,'text_verified',new_row.text_verified);
end;
$$;
revoke all on function public.discover_correct_observation_item(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.discover_correct_observation_item(uuid,uuid,uuid,jsonb) to service_role;