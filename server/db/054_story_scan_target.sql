-- Story → "Scan by": a branch, a pull request or a commit of the project's repository.
-- code_target holds the branch name, the pull request number or the commit SHA. code_branch stays for older stories.
alter table project_stories add column if not exists code_target_type text not null default 'BRANCH';
alter table project_stories add column if not exists code_target text;
do $$ begin
  alter table project_stories add constraint project_stories_code_target_type_check
    check (code_target_type in ('BRANCH','PULL_REQUEST','COMMIT'));
exception when duplicate_object then null; end $$;
update project_stories set code_target = code_branch where code_target is null and code_branch is not null;
