-- Every project has the 4 standard teams saved in the DB.
insert into teams(name, project_id, created_by)
select d.name, p.id, p.created_by
  from projects p
 cross join (values ('QA team'), ('Development team'), ('Project management'), ('Observers')) as d(name)
 where not exists (select 1 from teams t where t.project_id = p.id and lower(t.name) = lower(d.name));

-- Link every project-owned team to its project (used by the task-assignment rule).
insert into project_teams(project_id, team_id)
select project_id, id from teams where project_id is not null
on conflict do nothing;

-- Remove team links of people who are no longer members of that project.
delete from team_members tm
 using teams t
 where t.id = tm.team_id
   and t.project_id is not null
   and not exists (select 1 from project_members pm where pm.project_id = t.project_id and pm.user_id = tm.user_id);
