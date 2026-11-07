-- Every project member is in a team: members without one go to the team that matches their role.
insert into team_members(team_id, user_id)
select t.id, pm.user_id
  from project_members pm
  join teams t on t.project_id = pm.project_id
   and lower(t.name) = lower(case pm.project_role
        when 'QA' then 'QA team'
        when 'DEVELOPER' then 'Development team'
        when 'PROJECT_MANAGER' then 'Project management'
        else 'Observers' end)
 where not exists (select 1 from team_members tm join teams t2 on t2.id = tm.team_id
                    where t2.project_id = pm.project_id and tm.user_id = pm.user_id)
on conflict do nothing;
