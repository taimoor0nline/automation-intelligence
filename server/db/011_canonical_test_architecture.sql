CREATE TABLE IF NOT EXISTS canonical_element_registries (
  session_id TEXT PRIMARY KEY REFERENCES test_sessions(id) ON DELETE CASCADE,
  registry_hash TEXT,
  registry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canonical_generation_plans (
  session_id TEXT PRIMARY KEY REFERENCES test_sessions(id) ON DELETE CASCADE,
  plan_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canonical_test_ir (
  session_id TEXT NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
  external_case_id TEXT NOT NULL,
  planned_id TEXT,
  ir_version INTEGER NOT NULL DEFAULT 1,
  ir_json JSONB NOT NULL,
  validation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(session_id, external_case_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_ir_planned ON canonical_test_ir(session_id, planned_id);
