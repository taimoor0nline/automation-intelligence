-- Normalize scenario type and priority alongside test_category for indexed reporting.

ALTER TABLE test_results
  ADD COLUMN IF NOT EXISTS scenario_type TEXT NOT NULL DEFAULT 'functional';

ALTER TABLE test_results
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';

-- Existing reviewed cases already have dedicated type/priority columns. Normalize legacy values.
UPDATE test_cases
   SET type = CASE
     WHEN lower(coalesce(type, case_json->>'type', 'functional')) IN ('positive','negative','boundary','functional','custom')
       THEN lower(coalesce(type, case_json->>'type', 'functional'))
     ELSE 'functional'
   END,
       priority = CASE
     WHEN lower(coalesce(priority, case_json->>'priority', 'medium')) IN ('low','medium','high')
       THEN lower(coalesce(priority, case_json->>'priority', 'medium'))
     ELSE 'medium'
   END;

-- Historical execution rows inherit classification from the reviewed case belonging to the run/session.
UPDATE test_results result_row
   SET scenario_type = coalesce(case_row.type, 'functional'),
       priority = coalesce(case_row.priority, 'medium')
  FROM test_runs run_row, test_cases case_row
 WHERE result_row.run_id = run_row.id
   AND case_row.session_id = run_row.session_id
   AND case_row.external_case_id = result_row.external_case_id;

DO $$ BEGIN
  ALTER TABLE test_cases
    ADD CONSTRAINT chk_test_cases_scenario_type
    CHECK (type IS NULL OR type IN ('positive','negative','boundary','functional','custom'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE test_cases
    ADD CONSTRAINT chk_test_cases_priority
    CHECK (priority IS NULL OR priority IN ('low','medium','high'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE test_results
    ADD CONSTRAINT chk_test_results_scenario_type
    CHECK (scenario_type IN ('positive','negative','boundary','functional','custom'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE test_results
    ADD CONSTRAINT chk_test_results_priority
    CHECK (priority IN ('low','medium','high'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_test_cases_type_priority
  ON test_cases(type, priority, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_test_results_type_priority
  ON test_results(scenario_type, priority, passed, created_at DESC);
