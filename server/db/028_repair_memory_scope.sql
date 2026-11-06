-- AI learning scope: PROJECT (only the project it came from) or GLOBAL (shared with all projects).
alter table ai_repair_memory add column if not exists scope text not null default 'PROJECT';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_repair_memory_scope_check') then
    alter table ai_repair_memory add constraint ai_repair_memory_scope_check check (scope in ('PROJECT','GLOBAL'));
  end if;
end $$;
create index if not exists idx_ai_repair_memory_global on ai_repair_memory(scope) where scope = 'GLOBAL';
