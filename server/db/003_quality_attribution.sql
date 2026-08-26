ALTER TABLE defect_analyses
  ADD COLUMN IF NOT EXISTS source_commit_sha TEXT,
  ADD COLUMN IF NOT EXISTS attributed_developer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attribution_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS attribution_source TEXT,
  ADD COLUMN IF NOT EXISTS complexity_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_defects_attributed_developer
  ON defect_analyses(attributed_developer_user_id, created_at DESC);

-- IMPORTANT: attributed_developer_user_id is intentionally independent from assigned_to.
-- assigned_to = remediation workflow owner.
-- attributed_developer_user_id = future evidence-backed code/change attribution for normalized manager analytics.
