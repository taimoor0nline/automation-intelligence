-- Undo 060: new projects no longer get a settings row, and new rows start with auto-create off again.
-- Settings rows already created stay as they are (turn a project off in its workflow settings if needed).
drop trigger if exists trg_projects_default_workflow_settings on projects;
drop function if exists projects_default_workflow_settings();
alter table project_workflow_settings alter column auto_create_failed_tasks set default false;
