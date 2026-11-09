-- Keep each run's AI analysis report (Runs & reports → AI report), so a re-run never replaces an earlier run's report.
alter table test_report_snapshots drop constraint if exists test_report_snapshots_report_kind_check;
alter table test_report_snapshots add constraint test_report_snapshots_report_kind_check
  check (report_kind in ('REVIEWED_CASE','EXECUTION','AI_LEARNING','AI_ANALYSIS'));
