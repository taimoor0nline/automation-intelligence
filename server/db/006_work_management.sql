CREATE TABLE IF NOT EXISTS project_role_definitions (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO project_role_definitions(code,display_name,description,sort_order) VALUES
('PROJECT_MANAGER','Project Manager','Manages project membership, assignments and workflow.',10),
('QA','QA','Designs, reviews, executes and retests test cases.',20),
('DEVELOPER','Developer','Works assigned defects and implementation tasks.',30),
('VIEWER','Viewer','Read-only project access.',40)
ON CONFLICT(code) DO UPDATE SET display_name=excluded.display_name,description=excluded.description,sort_order=excluded.sort_order;

ALTER TABLE project_members ADD COLUMN IF NOT EXISTS project_role TEXT;
UPDATE project_members
SET project_role = CASE role::text
  WHEN 'MANAGER' THEN 'PROJECT_MANAGER'
  WHEN 'DEV' THEN 'DEVELOPER'
  WHEN 'QA' THEN 'QA'
  ELSE 'VIEWER'
END
WHERE project_role IS NULL;
ALTER TABLE project_members ALTER COLUMN project_role SET DEFAULT 'VIEWER';

DO $$ BEGIN
  ALTER TABLE project_members ADD CONSTRAINT fk_project_members_project_role
    FOREIGN KEY(project_role) REFERENCES project_role_definitions(code);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES test_sessions(id) ON DELETE SET NULL,
  run_id UUID REFERENCES test_runs(id) ON DELETE SET NULL,
  test_case_id UUID REFERENCES test_cases(id) ON DELETE SET NULL,
  test_result_id UUID REFERENCES test_results(id) ON DELETE SET NULL,
  defect_analysis_id UUID REFERENCES defect_analyses(id) ON DELETE SET NULL,
  external_case_id TEXT,
  work_type TEXT NOT NULL DEFAULT 'GENERAL' CHECK (work_type IN ('TEST_REVIEW','DEFECT_FIX','RETEST','INVESTIGATION','MANUAL_TEST','GENERAL')),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','ON_HOLD','READY_FOR_RETEST','COMPLETED','CANCELLED')),
  priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work_item_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  comment TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work_item_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('IN_APP','EMAIL','TEAMS','SLACK','WEBHOOK')),
  event_type TEXT NOT NULL,
  subject TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','CANCELLED')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_members_project_role ON project_members(project_id,project_role,user_id);
CREATE INDEX IF NOT EXISTS idx_work_items_project_status ON work_items(project_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_items_assigned_status ON work_items(assigned_to,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_items_case ON work_items(project_id,external_case_id);
CREATE INDEX IF NOT EXISTS idx_work_history_item_created ON work_item_history(work_item_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_comments_item_created ON work_item_comments(work_item_id,created_at);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending ON notification_outbox(status,next_attempt_at,created_at) WHERE status IN ('PENDING','FAILED');
