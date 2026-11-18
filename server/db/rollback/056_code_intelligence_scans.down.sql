-- Rollback of 056_code_intelligence_scans.sql (CI-001 "migrations reversible").
-- Run by hand on a database that needs it, then remove the 056 row from schema_migrations:
--   psql "$DATABASE_URL" -f server/db/rollback/056_code_intelligence_scans.down.sql
begin;
drop table if exists ci_finding_occurrences;
drop table if exists ci_findings;
drop table if exists ci_scan_jobs;
drop table if exists ci_scan_runs;
delete from schema_migrations where filename = '056_code_intelligence_scans.sql';
commit;
