-- Story points on a 1–10 scale (was 1, 2, 3, 5, 8, 13, 21). Any value above 10 is cleared so it can be re-estimated.
alter table project_stories drop constraint if exists project_stories_points_check;
update project_stories set story_points = null where story_points > 10;
alter table project_stories add constraint project_stories_points_check check (story_points is null or story_points between 1 and 10);
