-- Undo 063. Later attempts become their own scans again (new scan numbers after the highest one), then the
-- one-number-per-scan rule comes back.
with extra as (
  select id, project_id, row_number() over (partition by project_id order by created_at) rn
    from ci_scan_runs where attempt > 1
), top as (select project_id, max(scan_number) m from ci_scan_runs group by project_id)
update ci_scan_runs s set scan_number = top.m + extra.rn
  from extra join top on top.project_id = extra.project_id
 where s.id = extra.id;
drop index if exists ci_scan_runs_number_attempt_idx;
alter table ci_scan_runs drop column if exists attempt;
alter table ci_scan_runs add constraint ci_scan_runs_project_id_scan_number_key unique (project_id, scan_number);
