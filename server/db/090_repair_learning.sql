-- Repair learning is append/audit history, never a substitute for human-confirmed executable contracts.
-- Safe to re-run because existing migrations in this project are idempotent.
create table if not exists repair_learning_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references test_sessions(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  attempt_id uuid not null unique,
  external_case_id text not null,
  target_origin text,
  failure_signature char(64) not null,
  original_hash char(64) not null,
  candidate_hash char(64) not null,
  outcome text not null check (outcome in ('VALIDATED','REJECTED','ROLLED_BACK')),
  evidence_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_repair_learning_scope on repair_learning_events(project_id, target_origin, outcome, updated_at desc);
create index if not exists idx_repair_learning_session on repair_learning_events(session_id, external_case_id, updated_at desc);
