-- Page scope belongs to the story: scan its Known pages and linked pages (default), or only the environment's starting page.
alter table project_stories add column if not exists page_scope text not null default 'ALL_DISCOVERED_PAGES';
do $$ begin
  alter table project_stories add constraint project_stories_page_scope_check check (page_scope in ('ALL_DISCOVERED_PAGES','STARTING_PAGE_ONLY'));
exception when duplicate_object then null; end $$;
