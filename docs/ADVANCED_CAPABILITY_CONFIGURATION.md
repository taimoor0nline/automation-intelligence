# Advanced capability configuration

TestNexus supports two configuration sources for advanced automation capabilities.

## 1. Environment-only mode

Use this when `DATABASE_ENABLED=false`. The platform PostgreSQL layer is completely bypassed and capability configuration comes from `.env`.

### External adapter

```env
AUTOMATION_EXTERNAL_ADAPTER_URL=http://127.0.0.1:7100
AUTOMATION_EXTERNAL_ADAPTER_TOKEN_ENV=TESTNEXUS_ADAPTER_TOKEN
AUTOMATION_EXTERNAL_CAPABILITIES=EMAIL_SMS_OTP,CROSS_ORIGIN_IFRAME,REAL_MULTI_TAB
```

The adapter must implement:

```text
POST /capabilities/:capability
```

Recognized capabilities include `EMAIL_SMS_OTP`, `CROSS_ORIGIN_IFRAME`, `REAL_MULTI_TAB`, `CAPTCHA_BIOMETRIC`, `NATIVE_MOBILE`, `BROWSER_EXTENSION`, and `OS_DIALOG`.

Leave `AUTOMATION_EXTERNAL_ADAPTER_URL` empty when no external adapter is running. Readiness blocks tests that require a missing adapter.

### File upload fixtures

```env
AUTOMATION_UPLOAD_FIXTURE_DIR=./automation-system/fixtures/uploads
```

Only safe file names from this directory may be referenced by generated tests. Generated tests cannot supply arbitrary server paths.

### Visual baseline mode

```env
AUTOMATION_VISUAL_BASELINE_DIR=./automation-system/baselines
AUTOMATION_VISUAL_BASELINE_MODE=compare
```

Modes:

- `compare`: normal execution. An approved baseline must exist.
- `create-missing`: controlled baseline approval. Only a missing baseline can be created; an existing baseline is still compared and is not overwritten.

### Application database assertions

These are independent from the TestNexus platform database.

```env
AUTOMATION_DB_ASSERTIONS_ENABLED=true
AUTOMATION_DB_ASSERTION_URL=postgresql://readonly_user:secret@app-db:5432/application
AUTOMATION_DB_ASSERTION_QUERIES_JSON={"feedback_created":{"sql":"SELECT status FROM feedback WHERE id=$1","params":["feedbackId"]}}
```

The corresponding reviewed test case must include:

```json
{
  "testData": {
    "feedbackId": "12345"
  },
  "expectedResults": [
    "Database query \"feedback_created\" field \"status\" equals \"ACTIVE\""
  ]
}
```

AI never writes SQL. It may reference only configured query names. Only read-only `SELECT`/`WITH` statements are allowed.

## 2. Platform-database-backed configuration

Use this after setting:

```env
DATABASE_ENABLED=true
DATABASE_REQUIRED=true
DATABASE_URL=postgresql://...
```

Then run:

```bash
npm run db:migrate
```

Migration `010_automation_capability_config.sql` creates:

- `automation_capability_config`
- `automation_db_assertion_query`

The database stores non-secret capability configuration. Secrets remain in environment/secret storage and are referenced by environment-variable name.

### External adapter example

```sql
UPDATE automation_capability_config
SET enabled = true,
    settings = '{"url":"http://127.0.0.1:7100","capabilities":["EMAIL_SMS_OTP","CROSS_ORIGIN_IFRAME","REAL_MULTI_TAB"]}'::jsonb,
    secret_env_key = 'TESTNEXUS_ADAPTER_TOKEN',
    updated_at = now()
WHERE config_key = 'EXTERNAL_ADAPTER';
```

Keep the actual token outside PostgreSQL:

```env
TESTNEXUS_ADAPTER_TOKEN=replace-with-secret
```

### Named DB assertion example

The application-under-test database connection string remains in a secret environment variable:

```env
AUT_DB_READONLY_URL=postgresql://readonly_user:secret@app-db:5432/application
```

Configure the profile:

```sql
UPDATE automation_capability_config
SET enabled = true,
    settings = '{"connectionEnvKey":"AUT_DB_READONLY_URL","timeoutMs":3000}'::jsonb,
    updated_at = now()
WHERE config_key = 'DATABASE_ASSERTIONS';
```

Add an allow-listed query:

```sql
INSERT INTO automation_db_assertion_query
  (query_name, sql_text, parameter_keys, description, enabled)
VALUES
  ('feedback_created',
   'SELECT status FROM feedback WHERE id=$1',
   '["feedbackId"]'::jsonb,
   'Verify the submitted feedback state',
   true)
ON CONFLICT (query_name) DO UPDATE
SET sql_text = EXCLUDED.sql_text,
    parameter_keys = EXCLUDED.parameter_keys,
    description = EXCLUDED.description,
    enabled = EXCLUDED.enabled,
    updated_at = now();
```

When platform PostgreSQL is disabled, none of these configuration tables are queried.
