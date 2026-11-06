-- Teams owned by one project (option B: simple project teams).
-- Older global teams (project_id null) are left as they are.
alter table teams add column if not exists project_id uuid references projects(id) on delete cascade;
-- Team names only need to be unique inside a project (two projects can both have "Development").
drop index if exists uq_teams_name;
create unique index if not exists uq_teams_global_name on teams(lower(name)) where project_id is null;
create unique index if not exists uq_teams_project_name on teams(project_id, lower(name)) where project_id is not null;
