-- Rollback of 059_finding_snippets_ai_reviews.sql
begin;
drop table if exists ci_ai_reviews;
alter table ci_findings drop column if exists snippet_start_line;
alter table ci_findings drop column if exists code_snippet;
delete from schema_migrations where filename = '059_finding_snippets_ai_reviews.sql';
commit;
