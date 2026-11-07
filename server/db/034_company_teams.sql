-- Company-wide teams: teams are created once (Teams page) and assigned to projects.

-- How a person joined a project: DIRECT (added on their own, e.g. the project creator) or TEAM (through an assigned team).
alter table project_members add column if not exists source text not null default 'DIRECT';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'project_members_source_check') then
    alter table project_members add constraint project_members_source_check check (source in ('DIRECT','TEAM'));
  end if;
end $$;

-- Merge the teams that were created inside projects into company teams with the same name, keeping every member.
-- Empty project teams (the automatic standard teams nobody was added to) are not carried over.
insert into teams(name, created_by, created_at)
select distinct on (lower(t.name)) t.name, t.created_by, t.created_at
  from teams t
 where t.project_id is not null
   and exists (select 1 from team_members tm where tm.team_id = t.id)
   and not exists (select 1 from teams g where g.project_id is null and lower(g.name) = lower(t.name))
 order by lower(t.name), t.created_at;

insert into team_members(team_id, user_id)
select g.id, tm.user_id
  from teams t
  join team_members tm on tm.team_id = t.id
  join teams g on g.project_id is null and lower(g.name) = lower(t.name)
 where t.project_id is not null
on conflict do nothing;

-- Project members are left as they are (all DIRECT). Teams are assigned to projects from the Teams page.
delete from teams where project_id is not null;
