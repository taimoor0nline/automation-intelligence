-- Several test users per environment, each with a role (e.g. Admin, Manager, Customer) for role-based testing.
-- Each entry: {"id","role","username","passwordEncrypted"}. Passwords are encrypted (credentialVault), never plain text.
ALTER TABLE project_environments ADD COLUMN IF NOT EXISTS test_users JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Move an existing single test login into the list as the first user.
UPDATE project_environments
SET test_users = jsonb_build_array(jsonb_build_object(
  'id', gen_random_uuid()::text,
  'role', 'Default User',
  'username', test_username,
  'passwordEncrypted', test_password_encrypted))
WHERE test_users = '[]'::jsonb
  AND coalesce(test_username, '') <> ''
  AND test_password_encrypted IS NOT NULL;
