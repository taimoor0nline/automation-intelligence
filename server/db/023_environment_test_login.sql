-- Test login (of the application under test) stored with each project environment.
-- The password is stored encrypted (AES-256-GCM, see server/services/credentialVault.js), never as plain text.
ALTER TABLE project_environments ADD COLUMN IF NOT EXISTS login_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE project_environments ADD COLUMN IF NOT EXISTS test_username TEXT;
ALTER TABLE project_environments ADD COLUMN IF NOT EXISTS test_password_encrypted TEXT;
