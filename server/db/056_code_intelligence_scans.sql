-- Code Intelligence (CI-001, CI-003, CI-031): scan runs, one job per scanner, and findings with per-scan occurrences.
-- Rollback: server/db/rollback/056_code_intelligence_scans.down.sql

-- One scan of a repository at an exact commit (resolved from a branch, pull request or commit when the scan starts).
create table if not exists ci_scan_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  repository_id uuid references source_repositories(id) on delete set null,
  story_id uuid references project_stories(id) on delete set null,
  scan_number integer not null,
  repo_full_name text not null,
  target_type text not null default 'BRANCH' check (target_type in ('BRANCH','PULL_REQUEST','COMMIT')),
  target text not null,
  commit_sha text,
  categories text[] not null default array[]::text[],
  status text not null default 'QUEUED' check (status in ('QUEUED','PREPARING','RUNNING','NORMALIZING','COMPLETED','PARTIAL','FAILED','CANCELLED')),
  error text,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (project_id, scan_number)
);
create index if not exists ci_scan_runs_project_idx on ci_scan_runs(project_id, created_at desc);
create index if not exists ci_scan_runs_story_idx on ci_scan_runs(story_id);

-- One job per scanner in a scan (OpenGrep, Trivy, Gitleaks …) with its own status, version and result count.
create table if not exists ci_scan_jobs (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null references ci_scan_runs(id) on delete cascade,
  category text not null,
  scanner text not null,
  scanner_version text,
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','COMPLETED','FAILED','SKIPPED')),
  findings_count integer not null default 0,
  error text,
  started_at timestamptz,
  completed_at timestamptz
);
create index if not exists ci_scan_jobs_run_idx on ci_scan_jobs(scan_run_id);

-- A finding is one problem in one repository. Its fingerprint stays the same across scans (line moves do not create
-- a new finding), so a re-scan updates it instead of adding a duplicate. Secrets are stored redacted only.
create table if not exists ci_findings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  repository_id uuid references source_repositories(id) on delete cascade,
  fingerprint text not null,
  category text not null check (category in ('SAST','SCA','SECRETS','CONTAINER','IAC','QUALITY')),
  scanner text not null,
  rule_id text not null,
  title text not null,
  severity text not null check (severity in ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),
  cwe text,
  cve text,
  file_path text,
  line integer,
  package_name text,
  installed_version text,
  fixed_version text,
  message text,
  status text not null default 'OPEN' check (status in ('OPEN','CONFIRMED','FALSE_POSITIVE','ACCEPTED_RISK','FIXED','REOPENED')),
  first_seen_scan_id uuid references ci_scan_runs(id) on delete set null,
  last_seen_scan_id uuid references ci_scan_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, repository_id, fingerprint)
);
create index if not exists ci_findings_project_idx on ci_findings(project_id, severity);

-- Where a finding was seen in a given scan.
create table if not exists ci_finding_occurrences (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references ci_findings(id) on delete cascade,
  scan_run_id uuid not null references ci_scan_runs(id) on delete cascade,
  file_path text,
  line integer,
  created_at timestamptz not null default now(),
  unique (finding_id, scan_run_id)
);
create index if not exists ci_finding_occurrences_run_idx on ci_finding_occurrences(scan_run_id);
