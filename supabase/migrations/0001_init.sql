-- Kargo Hiring Dashboard: initial schema
-- Run in the Supabase SQL editor (or `supabase db push`).
-- All access goes through the server using the service-role key. RLS is enabled with
-- no policies, so the anon key cannot read anything, candidate PII included.

create extension if not exists "pgcrypto";

do $$ begin
  create type role_code as enum ('PM', 'SPM');
exception when duplicate_object then null; end $$;

do $$ begin
  create type processing_status as enum ('queued', 'processing', 'completed', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type workflow_status as enum ('processing', 'analysed', 'shortlisted', 'finalist', 'selected', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type email_type as enum ('offer', 'rejection');
exception when duplicate_object then null; end $$;

do $$ begin
  create type email_status as enum ('draft', 'approved', 'sent', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Rubric: one row per criterion per role, seeded from rubric.txt only.
-- ---------------------------------------------------------------------------
create table if not exists rubric_criteria (
  id              uuid primary key default gen_random_uuid(),
  role            role_code not null,
  position        int not null,
  criterion_name  text not null,
  description     text not null,
  weight          numeric(5,2) not null check (weight > 0 and weight <= 100),
  created_at      timestamptz not null default now(),
  unique (role, position)
);

-- ---------------------------------------------------------------------------
-- Candidates. private_* columns are PII; they are never sent to any AI model.
-- anonymised_cv_content is the only CV text the AI pipeline may read.
-- ---------------------------------------------------------------------------
create table if not exists candidates (
  id                     uuid primary key default gen_random_uuid(),
  batch_id               uuid not null,
  applied_role           role_code not null,
  original_file_name     text not null,
  private_name           text,
  private_email          text,
  private_phone          text,
  anonymised_cv_content  text,
  redaction_summary      jsonb not null default '{}'::jsonb,
  profile                jsonb,
  processing_status      processing_status not null default 'queued',
  processing_error       text,
  processing_attempts    int not null default 0,
  workflow_status        workflow_status not null default 'processing',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists candidates_processing_idx on candidates (processing_status, updated_at);
create index if not exists candidates_batch_idx on candidates (batch_id);
create index if not exists candidates_role_idx on candidates (applied_role, workflow_status);

-- Every candidate is scored against both rubrics: one row per (candidate, role).
create table if not exists candidate_scores (
  id                   uuid primary key default gen_random_uuid(),
  candidate_id         uuid not null references candidates(id) on delete cascade,
  role                 role_code not null,
  overall_score        numeric(5,2) not null check (overall_score between 0 and 100),
  criterion_scores     jsonb not null,
  generated_reasoning  text not null,
  model                text not null,
  created_at           timestamptz not null default now(),
  unique (candidate_id, role)
);

create table if not exists candidate_assessments (
  id                   uuid primary key default gen_random_uuid(),
  candidate_id         uuid not null unique references candidates(id) on delete cascade,
  role                 role_code not null,
  interview_brief      text not null,
  strongest_evidence   text not null,
  biggest_probe_area   text not null,
  key_uncertainty      text not null,
  strengths            jsonb not null default '[]'::jsonb,
  gaps                 jsonb not null default '[]'::jsonb,
  risks                jsonb not null default '[]'::jsonb,
  interview_questions  jsonb not null default '[]'::jsonb,
  model                text not null,
  created_at           timestamptz not null default now()
);

create table if not exists email_drafts (
  id                   uuid primary key default gen_random_uuid(),
  candidate_id         uuid not null references candidates(id) on delete cascade,
  email_type           email_type not null,
  subject              text not null,
  body                 text not null,
  status               email_status not null default 'draft',
  edited_by_founder    boolean not null default false,
  approved_at          timestamptz,
  sent_at              timestamptz,
  error                text,
  provider_message_id  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- At most one live draft per candidate per email type.
create unique index if not exists email_drafts_one_per_type on email_drafts (candidate_id, email_type);

create table if not exists audit_log (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid references candidates(id) on delete set null,
  action        text not null,
  actor         text not null check (actor in ('founder', 'system')),
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists audit_candidate_idx on audit_log (candidate_id, created_at desc);

create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
insert into settings (key, value) values
  ('shortlist_size', '{"PM": 5, "SPM": 5}'::jsonb),
  ('min_recommend_score', '50'::jsonb)
on conflict (key) do nothing;

-- updated_at triggers
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists candidates_touch on candidates;
create trigger candidates_touch before update on candidates for each row execute function touch_updated_at();
drop trigger if exists email_drafts_touch on email_drafts;
create trigger email_drafts_touch before update on email_drafts for each row execute function touch_updated_at();

-- Atomically claim queued candidates for processing, so several workers can run safely.
-- Rows stuck in 'processing' for more than 10 minutes (a crashed worker) are reclaimed.
create or replace function claim_candidates(max_count int)
returns setof candidates language plpgsql as $$
begin
  return query
  update candidates c
     set processing_status = 'processing',
         processing_attempts = c.processing_attempts + 1,
         processing_error = null
   where c.id in (
     select id from candidates
      where processing_status = 'queued'
         or (processing_status = 'processing' and updated_at < now() - interval '10 minutes')
      order by created_at
      limit max_count
      for update skip locked
   )
  returning c.*;
end $$;

alter table rubric_criteria        enable row level security;
alter table candidates             enable row level security;
alter table candidate_scores       enable row level security;
alter table candidate_assessments  enable row level security;
alter table email_drafts           enable row level security;
alter table audit_log              enable row level security;
alter table settings               enable row level security;
