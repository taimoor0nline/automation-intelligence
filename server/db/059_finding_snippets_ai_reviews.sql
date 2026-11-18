-- Code Intelligence AI on demand (CI-036):
-- 1) each finding keeps ~10 lines of code around it (secrets masked), captured before the scanned code is deleted;
-- 2) ci_ai_reviews keeps the AI's explanation of a finding (advice only, shown as "AI · unverified").
-- Rollback: server/db/rollback/059_finding_snippets_ai_reviews.down.sql
alter table ci_findings add column if not exists code_snippet text;
alter table ci_findings add column if not exists snippet_start_line integer;

create table if not exists ci_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references ci_findings(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  model text,
  result jsonb not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ci_ai_reviews_finding_idx on ci_ai_reviews(finding_id, created_at desc);
