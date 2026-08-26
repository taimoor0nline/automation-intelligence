CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('DEV','QA','MANAGER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,user_id)
);

CREATE TABLE IF NOT EXISTS source_repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'github',
  repo_full_name TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  repository_url TEXT,
  source_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, repo_full_name)
);

CREATE TABLE IF NOT EXISTS test_sessions (
  id TEXT PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'IDLE',
  story TEXT,
  target_url TEXT,
  environment TEXT,
  ai_model_tier TEXT,
  repository_id UUID REFERENCES source_repositories(id) ON DELETE SET NULL,
  session_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
  external_case_id TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT,
  priority TEXT,
  source TEXT,
  case_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, external_case_id)
);

CREATE TABLE IF NOT EXISTS test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  repository_id UUID REFERENCES source_repositories(id) ON DELETE SET NULL,
  run_number INTEGER NOT NULL,
  executed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  total INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  duration_ms BIGINT,
  browser TEXT,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, run_number)
);

CREATE TABLE IF NOT EXISTS test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  external_case_id TEXT,
  title TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  duration_ms BIGINT,
  error_message TEXT,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS defect_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  external_case_id TEXT,
  classification TEXT NOT NULL,
  severity TEXT,
  confidence NUMERIC(5,4),
  summary TEXT,
  probable_cause TEXT,
  resolution_comment TEXT,
  recommended_fix TEXT,
  recommended_owner TEXT,
  developer_review_area TEXT,
  developer_implementation_hint TEXT,
  developer_example_fix TEXT,
  source_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  regression_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(run_id, external_case_id)
);

-- Future manager analytics: keep raw attribution/complexity facts now, compute rankings later.
CREATE TABLE IF NOT EXISTS code_change_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_id UUID REFERENCES source_repositories(id) ON DELETE SET NULL,
  developer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  commit_sha TEXT,
  files_changed INTEGER,
  lines_added INTEGER,
  lines_deleted INTEGER,
  cyclomatic_complexity NUMERIC(10,3),
  cognitive_complexity NUMERIC(10,3),
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_runs_project_completed ON test_runs(project_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_results_run ON test_results(run_id);
CREATE INDEX IF NOT EXISTS idx_defects_run ON defect_analyses(run_id);
CREATE INDEX IF NOT EXISTS idx_defects_assigned ON defect_analyses(assigned_to, resolved_at);
CREATE INDEX IF NOT EXISTS idx_metrics_developer ON code_change_metrics(developer_user_id, measured_at DESC);
