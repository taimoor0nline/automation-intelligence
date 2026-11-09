-- Which run a re-run was started from (Runs & reports ↻), so a run can show "Times run" and "Re-run of Run #N".
-- The new run row is created when it finishes, so the link is keyed by session + run number.
create table if not exists test_run_reruns (
  session_id text not null,
  run_number integer not null,
  source_run_id uuid not null references test_runs(id) on delete cascade,
  case_ids jsonb not null default '[]'::jsonb,
  started_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (session_id, run_number)
);
create index if not exists idx_test_run_reruns_source on test_run_reruns(source_run_id);
