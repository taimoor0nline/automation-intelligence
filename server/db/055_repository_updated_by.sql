-- Source code tab: "Last updated" shows who changed a repository (default branch or token), like every other list.
alter table source_repositories add column if not exists updated_by uuid references users(id) on delete set null;
