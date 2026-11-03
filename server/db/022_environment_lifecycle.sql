-- Environment lifecycle: retain every historically referenced environment.
-- A disabled environment is kept for reporting, but not offered for new transactions.
ALTER TABLE project_environments ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE project_environments ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
ALTER TABLE project_environments ADD COLUMN IF NOT EXISTS disabled_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_project_environments_active ON project_environments(project_id,name) WHERE is_active=true;
