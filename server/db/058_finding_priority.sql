-- Findings keep both: severity (from the scan, fixed) and priority (how soon to fix, set by QA / PM).
-- Priority starts equal to severity (Info → Low). Once a person changes it, re-scans keep their choice.
-- Rollback: server/db/rollback/058_finding_priority.down.sql
alter table ci_findings add column if not exists priority text;
alter table ci_findings add column if not exists priority_manual boolean not null default false;
alter table ci_findings add column if not exists priority_updated_by uuid references users(id) on delete set null;
alter table ci_findings add column if not exists priority_updated_at timestamptz;
update ci_findings set priority = case severity when 'INFO' then 'LOW' else severity end where priority is null;
alter table ci_findings alter column priority set not null;
do $$ begin
  alter table ci_findings add constraint ci_findings_priority_check check (priority in ('CRITICAL','HIGH','MEDIUM','LOW'));
exception when duplicate_object then null; end $$;
