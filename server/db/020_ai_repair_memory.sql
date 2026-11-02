-- Durable, project-scoped repair learning; only verified candidates are eligible for reuse.
CREATE TABLE IF NOT EXISTS ai_repair_memory (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL,
 failure_signature TEXT NOT NULL,
 original_selector TEXT NOT NULL,
 replacement_selector TEXT NOT NULL,
 page_path TEXT NOT NULL DEFAULT '/',
 status TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK(status IN ('CANDIDATE','VERIFIED','REJECTED','REVOKED')),
 verification_source TEXT,
 verification_run_id UUID REFERENCES test_runs(id) ON DELETE SET NULL,
 verified_at TIMESTAMPTZ,
 success_count INTEGER NOT NULL DEFAULT 0,
 failure_count INTEGER NOT NULL DEFAULT 0,
 last_used_at TIMESTAMPTZ,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(project_id,fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_ai_repair_memory_reuse ON ai_repair_memory(project_id,status,page_path,updated_at DESC);
CREATE TABLE IF NOT EXISTS ai_repair_reuse_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 memory_id UUID NOT NULL REFERENCES ai_repair_memory(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 session_id TEXT REFERENCES test_sessions(id) ON DELETE SET NULL,
 run_id UUID REFERENCES test_runs(id) ON DELETE SET NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('SUGGESTED','APPLIED','SUCCEEDED','FAILED','REVOKED')),
 actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(memory_id,run_id,event_type)
);
CREATE INDEX IF NOT EXISTS idx_ai_repair_reuse_events_memory ON ai_repair_reuse_events(memory_id,created_at DESC);
