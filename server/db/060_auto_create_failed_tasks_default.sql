-- Failed tests become tasks in every project by default (as in the Demo project).
-- 1. New settings rows start with "Auto-create tasks for failed tests" on.
-- 2. Every project without a settings row gets one now (on). A project where someone turned it off keeps "off".
-- 3. Every new project gets its settings row (on) when it is created.
alter table project_workflow_settings alter column auto_create_failed_tasks set default true;

insert into project_workflow_settings(project_id, auto_create_failed_tasks)
select p.id, true from projects p
 where not exists (select 1 from project_workflow_settings ws where ws.project_id = p.id)
on conflict (project_id) do nothing;

create or replace function projects_default_workflow_settings() returns trigger language plpgsql as $$
begin
  insert into project_workflow_settings(project_id, auto_create_failed_tasks) values (new.id, true)
  on conflict (project_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_projects_default_workflow_settings on projects;
create trigger trg_projects_default_workflow_settings after insert on projects
  for each row execute function projects_default_workflow_settings();
