ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS security_subcategory TEXT;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS severity TEXT;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS security_subcategory TEXT;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS severity TEXT;

UPDATE test_cases
SET severity = CASE lower(coalesce(priority,'medium'))
  WHEN 'high' THEN 'HIGH'
  WHEN 'low' THEN 'LOW'
  ELSE 'MEDIUM'
END
WHERE severity IS NULL AND test_category='SECURITY';

UPDATE test_results
SET severity = CASE lower(coalesce(priority,'medium'))
  WHEN 'high' THEN 'HIGH'
  WHEN 'low' THEN 'LOW'
  ELSE 'MEDIUM'
END
WHERE severity IS NULL AND test_category='SECURITY';

DO $$ BEGIN
  ALTER TABLE test_cases ADD CONSTRAINT chk_test_cases_security_subcategory
    CHECK (security_subcategory IS NULL OR security_subcategory IN (
      'AUTHENTICATION','AUTHORIZATION_RBAC','SESSION_MANAGEMENT','INPUT_VALIDATION','XSS','SQL_COMMAND_INJECTION','CSRF',
      'SECURITY_HEADERS','COOKIES','SENSITIVE_DATA_EXPOSURE','API_SECURITY','FILE_UPLOAD','ACCESS_CONTROL','RATE_LIMITING',
      'ERROR_INFORMATION_LEAKAGE','CORS','TLS_TRANSPORT','BUSINESS_LOGIC_ABUSE','LOGGING_AUDIT','DEPENDENCY_VULNERABILITY_SCAN','CUSTOM'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE test_results ADD CONSTRAINT chk_test_results_security_subcategory
    CHECK (security_subcategory IS NULL OR security_subcategory IN (
      'AUTHENTICATION','AUTHORIZATION_RBAC','SESSION_MANAGEMENT','INPUT_VALIDATION','XSS','SQL_COMMAND_INJECTION','CSRF',
      'SECURITY_HEADERS','COOKIES','SENSITIVE_DATA_EXPOSURE','API_SECURITY','FILE_UPLOAD','ACCESS_CONTROL','RATE_LIMITING',
      'ERROR_INFORMATION_LEAKAGE','CORS','TLS_TRANSPORT','BUSINESS_LOGIC_ABUSE','LOGGING_AUDIT','DEPENDENCY_VULNERABILITY_SCAN','CUSTOM'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE test_cases ADD CONSTRAINT chk_test_cases_security_severity
    CHECK (severity IS NULL OR severity IN ('INFORMATIONAL','LOW','MEDIUM','HIGH','CRITICAL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE test_results ADD CONSTRAINT chk_test_results_security_severity
    CHECK (severity IS NULL OR severity IN ('INFORMATIONAL','LOW','MEDIUM','HIGH','CRITICAL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE work_items DROP CONSTRAINT IF EXISTS work_items_work_type_check;
ALTER TABLE work_items ADD CONSTRAINT work_items_work_type_check
  CHECK (work_type IN ('TEST_REVIEW','DEFECT_FIX','SECURITY_REMEDIATION','RETEST','INVESTIGATION','MANUAL_TEST','GENERAL'));

CREATE INDEX IF NOT EXISTS idx_test_cases_security_subcategory ON test_cases(security_subcategory) WHERE security_subcategory IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_test_cases_severity ON test_cases(severity) WHERE severity IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_test_results_security_subcategory ON test_results(security_subcategory) WHERE security_subcategory IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_test_results_severity ON test_results(severity) WHERE severity IS NOT NULL;
