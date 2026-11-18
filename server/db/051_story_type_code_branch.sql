-- Story type: what the story is tested with (Functional, Code Intelligence; more types later).
-- Code branch: the repository branch a Code Intelligence story is checked on (null = the project's default branch).
alter table project_stories add column if not exists story_types text[] not null default array['FUNCTIONAL']::text[];
alter table project_stories add column if not exists code_branch text;
do $$ begin
  alter table project_stories add constraint project_stories_story_types_check
    check (cardinality(story_types) >= 1 and story_types <@ array['FUNCTIONAL','CODE_INTELLIGENCE']::text[]);
exception when duplicate_object then null; end $$;
