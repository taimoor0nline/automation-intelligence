-- Active / Inactive belongs to a team's project assignment (Teams → Assign project), not to the project itself.
-- Undo 041 and keep the status on project_teams: an inactive assignment stays listed but gives no project access.
alter table projects drop column if exists is_active;
alter table project_teams add column if not exists is_active boolean not null default true;
alter table project_teams add column if not exists status_updated_at timestamptz;
alter table project_teams add column if not exists status_updated_by uuid references users(id) on delete set null;
