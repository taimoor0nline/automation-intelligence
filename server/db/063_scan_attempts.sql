-- Scanning the same thing again is a new attempt of the same scan, like a test run's attempts ("Times run").
-- The same thing = same project, repository, story and Scan by (branch, pull request or commit).
-- Scan #2 scanned three times = Scan #2 attempts 1, 2 and 3; each attempt keeps its own findings.
alter table ci_scan_runs add column if not exists attempt integer not null default 1;
alter table ci_scan_runs drop constraint if exists ci_scan_runs_project_id_scan_number_key;
create unique index if not exists ci_scan_runs_number_attempt_idx on ci_scan_runs(project_id, scan_number, attempt);
