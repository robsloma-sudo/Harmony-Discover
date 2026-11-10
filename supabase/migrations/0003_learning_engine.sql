-- DEVELOPMENT ONLY. Apply ONLY to a separate Harmony Discover DEV project.
-- Never apply to existing Harmony production. All raw learning writes are server-side.
create table if not exists public.learning_consent_records (
 id uuid primary key default gen_random_uuid(), subject_id uuid not null,
 purpose text not null check (purpose in ('personalization','aggregate_research','conversation_analysis')),
 granted boolean not null, policy_version text not null,
 capture_source text not null default 'discover_app', recorded_at timestamptz not null default now(),
 withdrawn_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists learning_consent_subject_purpose_idx on public.learning_consent_records(subject_id,purpose,recorded_at desc);

-- No free text, precise GPS, email, phone, or image URLs in this general event envelope.
create table if not exists public.learning_events (
 id uuid primary key default gen_random_uuid(), event_id uuid not null unique,
 subject_id uuid not null, session_id uuid,
 event_name text not null check (event_name in (
 'scan_started','scan_completed','extraction_corrected','menu_item_opened','journey_started',
 'journey_feedback_submitted','question_intent_selected','question_submitted','item_saved',
 'remix_created','remix_adjustment_made','recommendation_feedback','search_no_result',
 'entity_match_rejected','content_reported')),
 schema_version integer not null check(schema_version>0), occurred_at timestamptz not null,
 received_at timestamptz not null default now(), app_version text not null,
 platform text not null check(platform in ('ios','android')),
 consent_policy_version text not null,
 personalization_allowed boolean not null default false,
 aggregate_research_allowed boolean not null default false,
 conversation_analysis_allowed boolean not null default false,
 beverage_category text check(beverage_category in ('cocktail','wine','beer','spirits','other')),
 feature text, venue_region text,
 source_type text check(source_type in ('menu_scan','search','journey','collection','remix')),
 properties jsonb not null default '{}'::jsonb check(jsonb_typeof(properties)='object')
);
create index if not exists learning_events_name_time_idx on public.learning_events(event_name,occurred_at desc);
create index if not exists learning_events_aggregate_idx on public.learning_events(event_name,occurred_at,aggregate_research_allowed);

-- Question content is separate; API must encrypt before insert and redact before any analysis.
create table if not exists public.learning_question_records (
 id uuid primary key default gen_random_uuid(), event_id uuid not null unique references public.learning_events(event_id) on delete cascade,
 subject_id uuid not null, encrypted_question bytea not null,
 redaction_status text not null default 'pending' check(redaction_status in ('pending','redacted','rejected','deleted')),
 retention_expires_at timestamptz not null, created_at timestamptz not null default now()
);

-- Private taste profiles are distinct from aggregate research.
create table if not exists public.personal_taste_profiles (
 subject_id uuid primary key references auth.users(id) on delete cascade,
 explicit_preferences jsonb not null default '{}'::jsonb,
 inferred_preferences jsonb not null default '{}'::jsonb,
 profile_version integer not null default 1, updated_at timestamptz not null default now(),
 check(jsonb_typeof(explicit_preferences)='object'), check(jsonb_typeof(inferred_preferences)='object')
);

create table if not exists public.learning_trend_candidates (
 id uuid primary key default gen_random_uuid(), candidate_key text not null unique,
 title text not null, hypothesis text not null,
 learning_domain text not null check(learning_domain in ('journeys','cocktail_intelligence','flavor_intelligence','wine_intelligence','menu_intelligence','harmony_reason','discover_ux')),
 status text not null default 'candidate_created' check(status in ('candidate_created','quality_checked','human_review','research_requested','evidence_collected','improvement_proposed','approved','implemented','outcome_measured','rejected','insufficient_evidence','duplicate','expired')),
 window_start timestamptz not null, window_end timestamptz not null,
 distinct_subject_count integer not null default 0, distinct_session_count integer not null default 0,
 distinct_venue_count integer, privacy_threshold_met boolean not null default false,
 bias_notes text, metric_summary jsonb not null default '{}'::jsonb,
 priority_score numeric(5,4), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(window_end>window_start), check(distinct_subject_count>=0 and distinct_session_count>=0)
);
create table if not exists public.learning_research_tasks (
 id uuid primary key default gen_random_uuid(), trend_candidate_id uuid references public.learning_trend_candidates(id) on delete set null,
 title text not null, question text not null, target_system text not null,
 status text not null default 'open' check(status in ('open','in_progress','blocked','completed','cancelled')),
 evidence_links jsonb not null default '[]'::jsonb, owner_label text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.learning_improvement_proposals (
 id uuid primary key default gen_random_uuid(), research_task_id uuid references public.learning_research_tasks(id) on delete set null,
 target_component text not null, proposed_change text not null, evidence_summary text not null,
 approval_status text not null default 'pending' check(approval_status in ('pending','approved','rejected','implemented')),
 approved_by text, approved_at timestamptz, implementation_version text, created_at timestamptz not null default now()
);
create table if not exists public.learning_outcome_measurements (
 id uuid primary key default gen_random_uuid(), proposal_id uuid not null references public.learning_improvement_proposals(id) on delete cascade,
 metric_name text not null, baseline_value numeric, measured_value numeric,
 measurement_window_start timestamptz not null, measurement_window_end timestamptz not null,
 interpretation text, created_at timestamptz not null default now(), check(measurement_window_end>measurement_window_start)
);

alter table public.learning_consent_records enable row level security;
alter table public.learning_events enable row level security;
alter table public.learning_question_records enable row level security;
alter table public.learning_trend_candidates enable row level security;
alter table public.learning_research_tasks enable row level security;
alter table public.learning_improvement_proposals enable row level security;
alter table public.learning_outcome_measurements enable row level security;
alter table public.personal_taste_profiles enable row level security;
-- No client policies for raw events, consent, questions, or learning operations.
create policy "taste profile owner select" on public.personal_taste_profiles for select to authenticated using(auth.uid()=subject_id);
create policy "taste profile owner insert" on public.personal_taste_profiles for insert to authenticated with check(auth.uid()=subject_id);
create policy "taste profile owner update" on public.personal_taste_profiles for update to authenticated using(auth.uid()=subject_id) with check(auth.uid()=subject_id);
