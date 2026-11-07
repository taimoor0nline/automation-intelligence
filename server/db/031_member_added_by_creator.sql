-- Backfill "added by" for project managers who were added automatically when they created the project
-- (the create-project route adds the creator as project manager at the same moment).
-- Other old members stay null ("Not recorded"): there is no record of who added them.
update project_members pm
   set added_by = p.created_by
  from projects p
 where p.id = pm.project_id
   and pm.added_by is null
   and pm.user_id = p.created_by
   and pm.project_role = 'PROJECT_MANAGER';
