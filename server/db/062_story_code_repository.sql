-- A Code Intelligence story remembers which repository it scans (a project can link GitHub and GitLab repositories).
-- Without it the story's scan used the newest repository, so a pull request number could be looked for in the wrong one.
alter table project_stories add column if not exists code_repository_id uuid references source_repositories(id) on delete set null;

-- Existing code stories: the repository of their last successful scan.
update project_stories ps set code_repository_id = s.repository_id
  from (select distinct on (story_id) story_id, repository_id from ci_scan_runs
         where story_id is not null and repository_id is not null and status in ('COMPLETED', 'PARTIAL')
         order by story_id, created_at desc) s
 where s.story_id = ps.id and ps.code_repository_id is null;
