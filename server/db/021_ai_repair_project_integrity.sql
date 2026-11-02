-- Ensure repair verification and reuse links cannot cross project boundaries.
CREATE UNIQUE INDEX IF NOT EXISTS uq_test_runs_id_project_for_repair ON test_runs(id,project_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_test_sessions_id_project_for_repair ON test_sessions(id,project_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_repair_memory_id_project ON ai_repair_memory(id,project_id);

ALTER TABLE ai_repair_memory
 ADD CONSTRAINT fk_repair_verification_run_project
 FOREIGN KEY(verification_run_id,project_id) REFERENCES test_runs(id,project_id);

ALTER TABLE ai_repair_reuse_events
 ADD CONSTRAINT fk_repair_event_memory_project
 FOREIGN KEY(memory_id,project_id) REFERENCES ai_repair_memory(id,project_id) ON DELETE CASCADE;

ALTER TABLE ai_repair_reuse_events
 ADD CONSTRAINT fk_repair_event_run_project
 FOREIGN KEY(run_id,project_id) REFERENCES test_runs(id,project_id);

ALTER TABLE ai_repair_reuse_events
 ADD CONSTRAINT fk_repair_event_session_project
 FOREIGN KEY(session_id,project_id) REFERENCES test_sessions(id,project_id);
