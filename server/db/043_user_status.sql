-- Users page: accounts are deactivated, never deleted (their name stays on runs, tasks and the Audit).
-- Who created each account and who last changed it (role or Active / Inactive), shown as Created / Last updated.
alter table users add column if not exists created_by uuid references users(id) on delete set null;
alter table users add column if not exists updated_by uuid references users(id) on delete set null;
