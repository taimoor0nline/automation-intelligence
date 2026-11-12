-- Scrum estimate on a story (Fibonacci). Tasks linked to the story show it.
alter table project_stories add column if not exists story_points integer;
do $$ begin
  alter table project_stories add constraint project_stories_points_check check (story_points is null or story_points in (1,2,3,5,8,13,21));
exception when duplicate_object then null; end $$;
