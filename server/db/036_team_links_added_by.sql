-- Who added a member to a team, and who assigned a team to a project (shown in the Teams popups).
alter table team_members add column if not exists added_by uuid references users(id) on delete set null;
alter table project_teams add column if not exists added_by uuid references users(id) on delete set null;
