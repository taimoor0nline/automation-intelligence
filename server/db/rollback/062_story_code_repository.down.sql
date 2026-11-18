-- Undo 062: stories no longer remember a repository (their scans use the newest repository again).
alter table project_stories drop column if exists code_repository_id;
