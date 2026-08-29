-- Expand normalized test categories used by authoring, persistence and reporting.

ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS chk_test_cases_category;
ALTER TABLE test_results DROP CONSTRAINT IF EXISTS chk_test_results_category;

ALTER TABLE test_cases
  ADD CONSTRAINT chk_test_cases_category
  CHECK (test_category IN (
    'FUNCTIONAL','SMOKE','REGRESSION','SECURITY','PERFORMANCE','ACCESSIBILITY',
    'INTEGRATION','API','UI','COMPATIBILITY','LOAD','STRESS','CUSTOM'
  ));

ALTER TABLE test_results
  ADD CONSTRAINT chk_test_results_category
  CHECK (test_category IN (
    'FUNCTIONAL','SMOKE','REGRESSION','SECURITY','PERFORMANCE','ACCESSIBILITY',
    'INTEGRATION','API','UI','COMPATIBILITY','LOAD','STRESS','CUSTOM'
  ));

CREATE INDEX IF NOT EXISTS idx_test_cases_project_category_created
  ON test_cases(test_category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_test_results_category_created
  ON test_results(test_category, created_at DESC);
