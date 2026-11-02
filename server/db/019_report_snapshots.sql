-- Durable, project-scoped report revisions for review, execution, and AI learning.
CREATE TABLE IF NOT EXISTS test_report_snapshots (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
 run_id UUID REFERENCES test_runs(id) ON DELETE CASCADE,
 external_case_id TEXT,
 report_kind TEXT NOT NULL CHECK(report_kind IN ('REVIEWED_CASE','EXECUTION','AI_LEARNING')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 report_json JSONB NOT NULL,
 report_html TEXT,
 recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(session_id,run_id,report_kind,revision) NULLS NOT DISTINCT
);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_project ON test_report_snapshots(project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_session ON test_report_snapshots(session_id,report_kind,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_review_case_revision ON test_report_snapshots(session_id,external_case_id,revision) WHERE report_kind='REVIEWED_CASE';
