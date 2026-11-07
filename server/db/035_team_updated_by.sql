-- Who last changed a team, and when (shown as "Last updated" on the Teams page).
alter table teams add column if not exists updated_at timestamptz;
alter table teams add column if not exists updated_by uuid references users(id) on delete set null;
