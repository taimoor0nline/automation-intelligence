-- Undo 061. Code-problem tasks are kept as ordinary (manual) tasks; their links to findings and the accept / reject decisions are removed.
alter table ci_findings drop column if exists decided_at;
alter table ci_findings drop column if exists decided_by;
alter table ci_findings drop column if exists decision_reason;
drop table if exists ci_finding_task_links;
update work_items set origin = 'MANUAL' where origin = 'CODE_FINDING';
alter table work_items drop constraint if exists work_items_origin_check;
alter table work_items add constraint work_items_origin_check check (origin in ('MANUAL', 'FAILED_TEST'));
