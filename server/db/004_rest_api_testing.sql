CREATE TABLE IF NOT EXISTS api_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'REST' CHECK (target_type = 'REST'),
  discovery_mode TEXT NOT NULL CHECK (discovery_mode IN ('MANUAL','OPENAPI')),
  base_url TEXT NOT NULL,
  specification_url TEXT,
  auth_type TEXT NOT NULL DEFAULT 'NONE' CHECK (auth_type IN ('NONE','BASIC','BEARER','API_KEY_HEADER')),
  auth_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_target_id UUID NOT NULL REFERENCES api_targets(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('MANUAL','OPENAPI')),
  operation_key TEXT NOT NULL,
  operation_id TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  parameters JSONB NOT NULL DEFAULT '[]'::jsonb,
  request_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_example JSONB,
  responses JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(api_target_id, operation_key)
);

ALTER TABLE test_sessions
  ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'WEB',
  ADD COLUMN IF NOT EXISTS api_target_id UUID REFERENCES api_targets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS api_operation_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE test_runs
  ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'WEB',
  ADD COLUMN IF NOT EXISTS api_target_id UUID REFERENCES api_targets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_api_targets_project ON api_targets(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_operations_target ON api_operations(api_target_id, method, path);
CREATE INDEX IF NOT EXISTS idx_sessions_api_target ON test_sessions(api_target_id, updated_at DESC);
