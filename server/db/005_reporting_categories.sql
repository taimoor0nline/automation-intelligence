-- Reporting/category normalization for AI TestPilot.
-- Keep the full reviewed case in JSONB, while promoting frequently-filtered facts
-- to indexed columns so historical reporting does not depend on JSON scans.

ALTER TABLE test_cases
  ADD COLUMN IF NOT EXISTS test_category TEXT NOT NULL DEFAULT 'FUNCTIONAL';

ALTER TABLE test_results
  ADD COLUMN IF NOT EXISTS test_category TEXT NOT NULL DEFAULT 'FUNCTIONAL';

ALTER TABLE test_runs
  ADD COLUMN IF NOT EXISTS executed_by_role TEXT;

-- Backfill normalized category from older JSON records when possible.
UPDATE test_cases
   SET test_category = CASE
     WHEN upper(coalesce(case_json->>'testCategory', case_json->>'category', case_json#>>'{testData,__testCategory}', 'FUNCTIONAL'))
       IN ('FUNCTIONAL','SMOKE','REGRESSION','SECURITY','PERFORMANCE','ACCESSIBILITY','LOAD','STRESS')
     THEN upper(coalesce(case_json->>'testCategory', case_json->>'category', case_json#>>'{testData,__testCategory}', 'FUNCTIONAL'))
     ELSE 'FUNCTIONAL'
   END;

-- Historical result rows inherit category from their corresponding reviewed case.
-- Rows without a matching historical case remain FUNCTIONAL via the column default.
UPDATE test_results result_row
   SET test_category = case_row.test_category
  FROM test_runs run_row, test_cases case_row
 WHERE result_row.run_id = run_row.id
   AND case_row.session_id = run_row.session_id
   AND case_row.external_case_id = result_row.external_case_id;

UPDATE test_runs run_row
   SET executed_by_role = user_row.role::text
  FROM users user_row
 WHERE run_row.executed_by = user_row.id
   AND run_row.executed_by_role IS NULL;

DO $$ BEGIN
  ALTER TABLE test_cases
    ADD CONSTRAINT chk_test_cases_category
    CHECK (test_category IN ('FUNCTIONAL','SMOKE','REGRESSION','SECURITY','PERFORMANCE','ACCESSIBILITY','LOAD','STRESS'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE test_results
    ADD CONSTRAINT chk_test_results_category
    CHECK (test_category IN ('FUNCTIONAL','SMOKE','REGRESSION','SECURITY','PERFORMANCE','ACCESSIBILITY','LOAD','STRESS'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE test_runs
    ADD CONSTRAINT chk_test_runs_executed_role
    CHECK (executed_by_role IS NULL OR executed_by_role IN ('DEV','QA','MANAGER'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_test_cases_category ON test_cases(test_category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_results_category_outcome ON test_results(test_category, passed, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_runs_user_completed ON test_runs(executed_by, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_runs_role_completed ON test_runs(executed_by_role, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_sessions_environment ON test_sessions(environment, updated_at DESC);
