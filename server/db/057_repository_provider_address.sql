-- Source code: repositories can be on GitHub or GitLab. For GitLab, api_base_url is the GitLab address
-- (https://gitlab.com by default, or a company's own GitLab server). The provider column already exists (default 'github').
alter table source_repositories add column if not exists api_base_url text;
do $$ begin
  alter table source_repositories add constraint source_repositories_provider_check check (provider in ('github','gitlab'));
exception when duplicate_object then null; end $$;
