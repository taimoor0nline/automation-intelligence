CREATE TABLE IF NOT EXISTS test_run_evidence (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
 external_case_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('screenshot','video')),
 relative_path TEXT NOT NULL,
 bytes BIGINT NOT NULL,
 mime_type TEXT NOT NULL,
 captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(run_id,external_case_id,kind)
);
CREATE INDEX IF NOT EXISTS idx_test_run_evidence_run ON test_run_evidence(run_id,external_case_id);