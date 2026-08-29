CREATE TABLE IF NOT EXISTS automation_capability_config (
  config_key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_env_key text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_db_assertion_query (
  query_name text PRIMARY KEY,
  sql_text text NOT NULL,
  parameter_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_db_assertion_query_read_only CHECK (sql_text ~* '^\\s*(select|with)\\b')
);

INSERT INTO automation_capability_config (config_key, enabled, settings, secret_env_key)
VALUES
  ('EXTERNAL_ADAPTER', false, '{"url":"","capabilities":[]}'::jsonb, 'AUTOMATION_EXTERNAL_ADAPTER_TOKEN'),
  ('DATABASE_ASSERTIONS', false, '{"connectionEnvKey":"AUTOMATION_DB_ASSERTION_URL","timeoutMs":3000}'::jsonb, NULL),
  ('VISUAL_REGRESSION', true, '{"baselineMode":"compare"}'::jsonb, NULL),
  ('FILE_UPLOAD', true, '{}'::jsonb, NULL)
ON CONFLICT (config_key) DO NOTHING;
