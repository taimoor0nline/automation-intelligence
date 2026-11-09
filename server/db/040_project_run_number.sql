-- Runs & reports numbers runs across the whole project (Run #1, #2, #3…) instead of per testing session.
-- The number is given once to each run (not to its re-run attempts) and never changes.
alter table test_runs add column if not exists project_run_number integer;
create unique index if not exists uq_test_runs_project_run_number on test_runs(project_id,project_run_number) where project_run_number is not null;
