-- Code problems become tasks, like failed tests.
-- In the scan results QA or a Project Manager accepts or rejects each problem (the same problem in several places =
-- one problem). Accept creates one task, assigned by the system to the project's team; Reject keeps the reason.
-- The next scan checks the fix.

-- 1. Tasks from code problems.
alter table work_items drop constraint if exists work_items_origin_check;
alter table work_items add constraint work_items_origin_check check (origin in ('MANUAL', 'FAILED_TEST', 'CODE_FINDING'));

-- 2. Which problem places a task covers (one task, many findings).
create table if not exists ci_finding_task_links (
  work_item_id uuid not null references work_items(id) on delete cascade,
  finding_id uuid not null references ci_findings(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (work_item_id, finding_id)
);
create index if not exists ci_finding_task_links_finding_idx on ci_finding_task_links(finding_id);

-- 3. The accept / reject decision on a problem: who, when, and why (reason of a reject).
alter table ci_findings add column if not exists decision_reason text;
alter table ci_findings add column if not exists decided_by uuid references users(id) on delete set null;
alter table ci_findings add column if not exists decided_at timestamptz;
