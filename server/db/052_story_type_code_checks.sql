-- Story type lists the Code Intelligence checks themselves (like Security's sub-categories):
-- FUNCTIONAL, CODE_SAST, CODE_SECRETS, CODE_SCA, CODE_AI_REVIEW, CODE_QUALITY.
alter table project_stories drop constraint if exists project_stories_story_types_check;
-- A story saved with the earlier single "Code Intelligence" choice gets every code check.
update project_stories
   set story_types = array(select distinct x from unnest(array_remove(story_types,'CODE_INTELLIGENCE')
                     || array['CODE_SAST','CODE_SECRETS','CODE_SCA','CODE_AI_REVIEW','CODE_QUALITY']::text[]) x)
 where 'CODE_INTELLIGENCE' = any(story_types);
alter table project_stories add constraint project_stories_story_types_check
  check (cardinality(story_types) >= 1 and story_types <@ array['FUNCTIONAL','CODE_SAST','CODE_SECRETS','CODE_SCA','CODE_AI_REVIEW','CODE_QUALITY']::text[]);
