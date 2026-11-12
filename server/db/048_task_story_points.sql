-- Story points on a task (1–10), as on stories.
alter table work_items add column if not exists story_points integer;
do $$ begin
  alter table work_items add constraint work_items_points_check check (story_points is null or story_points between 1 and 10);
exception when duplicate_object then null; end $$;
