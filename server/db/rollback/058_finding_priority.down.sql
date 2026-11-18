-- Rollback of 058_finding_priority.sql
begin;
alter table ci_findings drop constraint if exists ci_findings_priority_check;
alter table ci_findings drop column if exists priority_updated_at;
alter table ci_findings drop column if exists priority_updated_by;
alter table ci_findings drop column if exists priority_manual;
alter table ci_findings drop column if exists priority;
delete from schema_migrations where filename = '058_finding_priority.sql';
commit;
