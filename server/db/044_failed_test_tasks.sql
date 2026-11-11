-- Failed tests as tasks (extends the project workflow "Auto-create tasks for failed tests").
-- The system assigns each failed test to the project's team, the role that fits the failure (QA / Developer / PM)
-- and the member of that role with the fewest open tasks. The assignee reports progress and time spent.
alter table work_items add column if not exists origin text not null default 'MANUAL';
alter table work_items add column if not exists team_id uuid references teams(id) on delete set null;
alter table work_items add column if not exists assigned_role text;
alter table work_items add column if not exists failure_count integer not null default 0;
alter table work_items add column if not exists first_failed_run_id uuid references test_runs(id) on delete set null;
alter table work_items add column if not exists last_failed_run_id uuid references test_runs(id) on delete set null;
alter table work_items add column if not exists progress_percent integer not null default 0;
alter table work_items add column if not exists time_spent_minutes integer not null default 0;
-- true while the system's choice stands; a person assigning or re-routing the task sets it to false for good.
alter table work_items add column if not exists assigned_by_system boolean not null default false;

do $$ begin
  alter table work_items add constraint work_items_origin_check check (origin in ('MANUAL','FAILED_TEST'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table work_items add constraint work_items_progress_check check (progress_percent between 0 and 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table work_items add constraint work_items_time_check check (time_spent_minutes >= 0);
exception when duplicate_object then null; end $$;

create index if not exists idx_work_items_team on work_items(team_id);
create index if not exists idx_work_items_origin on work_items(project_id, origin) where deleted_at is null;

-- Which test categories a team handles on a project (empty = all). Used when a project has several teams.
alter table project_teams add column if not exists handles text[] not null default '{}';
