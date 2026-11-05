-- Who created a test case and who last changed it (the signed-in TestNexus user), and when.
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Existing cases: the user who started their session created them.
UPDATE test_cases tc
SET created_by = coalesce(tc.created_by, s.created_by),
    updated_by = coalesce(tc.updated_by, s.created_by),
    updated_at = coalesce(tc.updated_at, tc.created_at)
FROM test_sessions s
WHERE s.id = tc.session_id AND (tc.created_by IS NULL OR tc.updated_at IS NULL);

UPDATE test_cases SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE test_cases ALTER COLUMN updated_at SET DEFAULT now();
