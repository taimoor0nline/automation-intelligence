-- Tasks get a short number per project (shown as T-0001) and can be linked to a story.
-- Subtasks use the existing parent_work_item_id. Numbers and the story of a failed-test task are filled in automatically.
alter table work_items add column if not exists task_number integer;
alter table work_items add column if not exists story_id uuid references project_stories(id) on delete set null;

-- Number existing tasks per project, oldest first.
with numbered as (
  select id, row_number() over (partition by project_id order by created_at, id) as n
    from work_items where task_number is null
)
update work_items w set task_number = numbered.n
  from numbered where numbered.id = w.id
   and not exists (select 1 from work_items x where x.project_id = w.project_id and x.task_number is not null);

-- Existing failed-test tasks take the story of the testing session they came from.
update work_items w set story_id = s.project_story_id
  from test_sessions s
 where s.id = w.session_id and w.story_id is null and s.project_story_id is not null;

create unique index if not exists idx_work_items_task_number on work_items(project_id, task_number);
create index if not exists idx_work_items_story on work_items(story_id);
create index if not exists idx_work_items_parent on work_items(parent_work_item_id);

-- Every new task gets the next number in its project; a task from a story's testing session gets that story.
create or replace function work_items_fill_number_and_story() returns trigger language plpgsql as $$
begin
  if new.task_number is null then
    perform pg_advisory_xact_lock(hashtext('work_items_task_number:' || new.project_id::text));
    select coalesce(max(task_number), 0) + 1 into new.task_number from work_items where project_id = new.project_id;
  end if;
  if new.story_id is null and new.session_id is not null then
    select project_story_id into new.story_id from test_sessions where id = new.session_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_work_items_fill_number_and_story on work_items;
create trigger trg_work_items_fill_number_and_story before insert on work_items
  for each row execute function work_items_fill_number_and_story();
