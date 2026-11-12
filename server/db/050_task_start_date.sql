-- Planned start date of a task (next to its due date).
alter table work_items add column if not exists start_at timestamptz;
