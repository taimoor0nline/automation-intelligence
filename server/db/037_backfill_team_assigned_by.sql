-- Fill "Assigned by" for team-to-project assignments made before 036 from the project Audit (TEAM_ATTACHED events).
update project_teams pt
   set added_by = e.actor_id
  from (
    select distinct on (project_id, metadata->>'teamId') project_id, metadata->>'teamId' team_id, actor_id
      from project_audit_events
     where event_type = 'TEAM_ATTACHED' and actor_id is not null
     order by project_id, metadata->>'teamId', created_at desc
  ) e
 where pt.added_by is null
   and e.project_id = pt.project_id
   and e.team_id = pt.team_id::text;
