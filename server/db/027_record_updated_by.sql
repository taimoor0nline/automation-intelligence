-- Record WHO last changed a record (the signed-in user), next to the existing updated_at.
-- Existing rows are not back-filled: who changed them was never saved, so the pages show "Not recorded".
alter table projects             add column if not exists updated_by uuid references users(id) on delete set null;
alter table project_environments add column if not exists updated_by uuid references users(id) on delete set null;
alter table work_items           add column if not exists updated_by uuid references users(id) on delete set null;
-- Who added a member to a project.
alter table project_members      add column if not exists added_by uuid references users(id) on delete set null;
