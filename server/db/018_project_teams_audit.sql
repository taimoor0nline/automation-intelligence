-- Reusable teams, project-specific team association, and story/test audit.
CREATE TABLE IF NOT EXISTS teams (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 name TEXT NOT NULL,
 description TEXT,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_name ON teams(lower(name));
CREATE TABLE IF NOT EXISTS team_members (
 team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(team_id,user_id)
);
CREATE TABLE IF NOT EXISTS project_teams (
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,team_id)
);
CREATE TABLE IF NOT EXISTS story_test_sessions (
 story_id UUID NOT NULL REFERENCES project_stories(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
 linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(story_id,session_id)
);
CREATE INDEX IF NOT EXISTS idx_story_test_sessions_session ON story_test_sessions(session_id);
CREATE TABLE IF NOT EXISTS project_audit_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 story_id UUID REFERENCES project_stories(id) ON DELETE SET NULL,
 work_item_id UUID REFERENCES work_items(id) ON DELETE SET NULL,
 session_id TEXT REFERENCES test_sessions(id) ON DELETE SET NULL,
 actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
 event_type TEXT NOT NULL,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_audit_events_project ON project_audit_events(project_id,created_at DESC);
