ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS project_story_id UUID REFERENCES project_stories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_test_sessions_project_story ON test_sessions(project_id,project_story_id);
CREATE TABLE IF NOT EXISTS project_workflow_settings (
 project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 auto_create_failed_tasks BOOLEAN NOT NULL DEFAULT FALSE,
 auto_close_verified_retests BOOLEAN NOT NULL DEFAULT FALSE,
 default_developer UUID REFERENCES users(id) ON DELETE SET NULL,
 updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);